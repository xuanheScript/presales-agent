import { after } from 'next/server'
import { flushLangfuse, withLangfuseTrace } from '@/lib/observability/langfuse'
import {
  beginPresalesExecution,
  classifyExecutionError,
  completePresalesExecution,
  finishPresalesExecution,
  preparePresalesExecution,
  PresalesExecutionError,
  streamPreparedPresalesWorkflow,
  type PresalesExecutionHandle,
} from '@/lib/agents/execution-service'
import { createManagedAbortSignal } from '@/lib/agents/execution-policy'
import type { WorkflowResult } from '@/lib/agents/state'

export const maxDuration = 300

interface RunRequest {
  projectId: string
  requirementId: string
}

export async function POST(req: Request) {
  let handle: PresalesExecutionHandle | null = null

  try {
    const { projectId, requirementId }: RunRequest = await req.json()
    const prepared = await preparePresalesExecution(projectId, requirementId)
    handle = await beginPresalesExecution(prepared, 'stream')
  } catch (error) {
    const status = error instanceof PresalesExecutionError ? error.status : 500
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : '服务器内部错误' }),
      { status, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const execution = handle
  const encoder = new TextEncoder()
  const streamController = new AbortController()
  const managed = createManagedAbortSignal([req.signal, streamController.signal])
  let closed = false
  let resolveExecutionDone!: () => void
  const executionDone = new Promise<void>((resolve) => {
    resolveExecutionDone = resolve
  })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        if (closed || managed.signal.aborted) return

        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          )
        } catch {
          closed = true
          streamController.abort(new DOMException('客户端连接已断开', 'AbortError'))
        }
      }

      const close = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          // 客户端已断开时无需再次关闭。
        }
      }

      try {
        const lastResult = await withLangfuseTrace(
          'presales-workflow',
          {
            input: {
              projectId: execution.prepared.projectId,
              requirementId: execution.prepared.requirementId,
              requirementLength: execution.prepared.rawRequirement.length,
            },
            metadata: {
              executionId: execution.executionId,
              userId: execution.prepared.userId,
              transport: execution.transport,
            },
          },
          async (observation) => {
            try {
              const workflowResult: WorkflowResult = {
                success: false,
                analysis: null,
                functions: [],
                identifiedRoles: [],
                additionalWork: [],
                estimation: null,
                cost: null,
                error: null,
              }

              for await (const update of streamPreparedPresalesWorkflow(execution, {
                signal: managed.signal,
              })) {
                sendEvent('progress', {
                  executionId: execution.executionId,
                  step: update.step,
                  isComplete: update.state.isComplete,
                  error: update.state.error,
                })

                if (update.state.analysis !== undefined) workflowResult.analysis = update.state.analysis || null
                if (update.state.functions !== undefined) workflowResult.functions = update.state.functions
                if (update.state.identifiedRoles !== undefined) workflowResult.identifiedRoles = update.state.identifiedRoles
                if (update.state.additionalWork !== undefined) workflowResult.additionalWork = update.state.additionalWork
                if (update.state.estimation !== undefined) workflowResult.estimation = update.state.estimation || null
                if (update.state.cost !== undefined) workflowResult.cost = update.state.cost || null
                if (update.state.error !== undefined) workflowResult.error = update.state.error || null
                workflowResult.success = Boolean(update.state.isComplete && !update.state.error)

                if (update.state.error) {
                  throw new PresalesExecutionError(update.state.error, 500)
                }
              }

              if (!workflowResult.success) {
                throw new PresalesExecutionError('工作流未完整结束', 500)
              }

              // 只有数据库事务提交成功后才通知客户端完成。
              await completePresalesExecution(execution, workflowResult)
              observation?.update({
                output: {
                  success: true,
                  functionsCount: workflowResult.functions.length,
                },
              })
              return workflowResult
            } catch (error) {
              const terminalStatus = classifyExecutionError(error, managed.signal)
              observation?.update({
                level: terminalStatus === 'failed' ? 'ERROR' : 'WARNING',
                statusMessage: error instanceof Error ? error.message : '工作流执行失败',
                output: { success: false, status: terminalStatus },
              })
              throw error
            }
          }
        )

        sendEvent('complete', {
          success: true,
          executionId: execution.executionId,
          data: lastResult,
        })
        close()
      } catch (error) {
        const terminalStatus = classifyExecutionError(error, managed.signal)
        await finishPresalesExecution(execution, terminalStatus, error)

        if (!managed.signal.aborted) {
          sendEvent('error', {
            executionId: execution.executionId,
            error: error instanceof Error ? error.message : '工作流执行失败',
          })
        }
        close()
      } finally {
        managed.dispose()
        resolveExecutionDone()
      }
    },
    cancel(reason) {
      closed = true
      streamController.abort(
        reason instanceof Error
          ? reason
          : new DOMException('客户端取消执行', 'AbortError')
      )
    },
  })

  after(async () => {
    await executionDone
    await flushLangfuse()
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Agent-Execution-Id': execution.executionId,
    },
  })
}
