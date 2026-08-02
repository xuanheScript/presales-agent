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
import {
  accumulateWorkflowUpdate,
  assertCompletedWorkflowResult,
  createCompleteEventAfterCommit,
  createPendingWorkflowResult,
  encodeSseEvent,
} from '@/lib/agents/sse-protocol'

export const maxDuration = 300

interface RunRequest {
  projectId: string
  requirementBaselineId: string
}

export async function POST(req: Request) {
  let handle: PresalesExecutionHandle | null = null

  try {
    const { projectId, requirementBaselineId }: RunRequest = await req.json()
    const prepared = await preparePresalesExecution(projectId, requirementBaselineId)
    handle = await beginPresalesExecution(prepared, 'stream')
  } catch (error) {
    const status = error instanceof PresalesExecutionError ? error.status : 500
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : '服务器内部错误' }),
      { status, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const execution = handle
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
          controller.enqueue(encodeSseEvent({
            event: event as 'progress' | 'complete' | 'error',
            data,
          }))
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
              requirementBaselineId: execution.prepared.requirementBaselineId,
              requirementLength: execution.prepared.canonicalRequirement.length,
            },
            metadata: {
              executionId: execution.executionId,
              userId: execution.prepared.userId,
              transport: execution.transport,
            },
          },
          async (observation) => {
            try {
              let workflowResult = createPendingWorkflowResult()

              for await (const update of streamPreparedPresalesWorkflow(execution, {
                signal: managed.signal,
              })) {
                sendEvent('progress', {
                  executionId: execution.executionId,
                  step: update.step,
                  isComplete: update.state.isComplete,
                  error: update.state.error,
                })

                workflowResult = accumulateWorkflowUpdate(workflowResult, update.state)

                if (workflowResult.error) {
                  throw new PresalesExecutionError(workflowResult.error, 500)
                }
              }

              assertCompletedWorkflowResult(workflowResult)

              // 只有数据库事务提交成功后才通知客户端完成。
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

        const completeEvent = await createCompleteEventAfterCommit(
          execution.executionId,
          lastResult,
          async (result) => completePresalesExecution(execution, result)
        )
        sendEvent(completeEvent.event, completeEvent.data)
        close()
      } catch (error) {
        const terminalStatus = classifyExecutionError(error, managed.signal)
        try {
          await finishPresalesExecution(execution, terminalStatus, error)
        } catch (finishError) {
          console.error('[SSE] Agent 执行终态保存失败:', finishError)
        }

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
