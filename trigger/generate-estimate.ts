import { task } from '@trigger.dev/sdk'
import { z } from 'zod'
import {
  beginPresalesExecution,
  classifyExecutionError,
  completePresalesExecution,
  executePreparedPresalesWorkflow,
  finishPresalesExecution,
  preparePresalesExecutionForWorker,
  PresalesExecutionError,
  type PresalesExecutionHandle,
} from '@/lib/agents/execution-service'
import { flushLangfuse, initLangfuse } from '@/lib/observability/langfuse'

const payloadSchema = z.strictObject({
  actorUserId: z.uuid(),
  projectId: z.uuid(),
  requirementBaselineId: z.uuid(),
})

export const generateEstimateTask = task({
  id: 'generate-estimate',
  maxDuration: 14_400,
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
    factor: 2,
    randomize: true,
  },
  run: async (payload: z.input<typeof payloadSchema>, { ctx, signal }) => {
    const parsed = payloadSchema.parse(payload)
    initLangfuse()
    let handle: PresalesExecutionHandle | null = null

    try {
      const prepared = await preparePresalesExecutionForWorker(
        parsed.actorUserId,
        parsed.projectId,
        parsed.requirementBaselineId
      )
      handle = await beginPresalesExecution(prepared, 'run', ctx.run.id)
      if (handle.existingEstimateVersionId) {
        return {
          executionId: handle.executionId,
          estimateVersionId: handle.existingEstimateVersionId,
          revisionCommitted: true,
        }
      }
      const result = await executePreparedPresalesWorkflow(handle, { signal })

      if (!result.success || result.error) {
        throw new PresalesExecutionError(result.error || '工作流执行失败', 500)
      }

      const estimateVersionId = await completePresalesExecution(handle, result)
      return {
        executionId: handle.executionId,
        estimateVersionId,
        revisionCommitted: true,
      }
    } catch (error) {
      if (handle) {
        try {
          await finishPresalesExecution(handle, classifyExecutionError(error, signal), error)
        } catch (finishError) {
          console.error('[Trigger] 估算执行终态保存失败，将由巡检任务修复:', {
            executionId: handle.executionId,
            error: finishError instanceof Error ? finishError.message : 'unknown',
          })
        }
      }
      throw error
    } finally {
      await flushLangfuse()
    }
  },
})
