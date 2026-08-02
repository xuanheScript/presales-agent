import { after, NextResponse } from 'next/server'
import { flushLangfuse } from '@/lib/observability/langfuse'
import {
  beginPresalesExecution,
  classifyExecutionError,
  completePresalesExecution,
  executePreparedPresalesWorkflow,
  finishPresalesExecution,
  preparePresalesExecution,
  PresalesExecutionError,
  type PresalesExecutionHandle,
} from '@/lib/agents/execution-service'

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
    handle = await beginPresalesExecution(prepared, 'run')

    const result = await executePreparedPresalesWorkflow(handle, {
      signal: req.signal,
    })

    if (!result.success || result.error) {
      throw new PresalesExecutionError(result.error || '工作流执行失败', 500)
    }

    await completePresalesExecution(handle, result)

    return NextResponse.json({
      success: true,
      executionId: handle.executionId,
      data: result,
    })
  } catch (error) {
    console.error('[API] Agent 执行失败:', error)

    if (handle) {
      await finishPresalesExecution(
        handle,
        classifyExecutionError(error, req.signal),
        error
      )
    }

    const status = error instanceof PresalesExecutionError ? error.status : 500
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '服务器内部错误' },
      { status }
    )
  } finally {
    after(() => flushLangfuse())
  }
}
