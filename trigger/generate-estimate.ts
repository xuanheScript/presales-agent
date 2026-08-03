import { task } from '@trigger.dev/sdk'
import { z } from 'zod'
import {
  beginPresalesExecution,
  completePresalesExecution,
  executePreparedPresalesWorkflow,
  preparePresalesExecutionForWorker,
  PresalesExecutionError,
} from '@/lib/agents/execution-service'
import {
  finalizePresalesExecutionByRunId,
  hashWorkUnitValue,
  initializePresalesExecutionPlan,
} from '@/lib/agents/work-unit-store'
import { flushLangfuse, initLangfuse } from '@/lib/observability/langfuse'

const payloadSchema = z.strictObject({
  actorUserId: z.uuid(),
  projectId: z.uuid(),
  requirementBaselineId: z.uuid(),
})

export const generateEstimateTask = task<
  'generate-estimate',
  z.input<typeof payloadSchema>,
  { executionId: string; estimateVersionId: string; revisionCommitted: boolean }
>({
  id: 'generate-estimate',
  maxDuration: 14_400,
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
    factor: 2,
    randomize: true,
  },
  onFailure: async ({ ctx, error, signal }) => {
    try {
      const { classifyExecutionError } = await import('@/lib/agents/execution-service')
      await finalizePresalesExecutionByRunId({
        orchestrationRunId: ctx.run.id,
        status: classifyExecutionError(error, signal),
        errorMessage: error instanceof Error ? error.message : '后台估算永久失败',
      })
    } catch (finalizeError) {
      console.error('[Trigger] 永久失败终态保存失败，将由租约巡检收敛:', finalizeError)
    }
  },
  run: async (payload: z.input<typeof payloadSchema>, { ctx, signal }) => {
    const parsed = payloadSchema.parse(payload)
    initLangfuse()

    try {
      const prepared = await preparePresalesExecutionForWorker(
        parsed.actorUserId,
        parsed.projectId,
        parsed.requirementBaselineId
      )
      const handle = await beginPresalesExecution(prepared, 'run', ctx.run.id)
      if (handle.existingEstimateVersionId) {
        return {
          executionId: handle.executionId,
          estimateVersionId: handle.existingEstimateVersionId,
          revisionCommitted: true,
        }
      }
      await initializePresalesExecutionPlan({
        actorUserId: prepared.userId,
        executionId: handle.executionId,
        baselineId: prepared.requirementBaselineId,
        contentHash: prepared.requirementBaselineContentHash,
        capacityPlan: prepared.capacityPlan,
        profileVersion: prepared.provenance.modelProfileVersion,
        discoveryVersion: 'full-document-discovery-v1',
        promptBundleHash: hashWorkUnitValue(prepared.provenance.promptVersions),
      })
      const result = await executePreparedPresalesWorkflow(handle, {
        signal,
        workerId: ctx.run.id,
        durableDiscovery: true,
      })

      if (!result.success || result.error) {
        throw new PresalesExecutionError(result.error || '工作流执行失败', 500)
      }

      const estimateVersionId = await completePresalesExecution(handle, result)
      return {
        executionId: handle.executionId,
        estimateVersionId,
        revisionCommitted: true,
      }
    } finally {
      // Trigger 的 attempt 失败时保持 execution running，由相同 run ID 的后续 attempt
      // 复用已成功工作单元；永久失败由租约巡检统一收敛。
      await flushLangfuse()
    }
  },
})
