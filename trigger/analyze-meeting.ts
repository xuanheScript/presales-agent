import { task, wait } from '@trigger.dev/sdk'
import { z } from 'zod'
import { runMeetingAnalysisOrchestration } from '@/lib/meetings/analysis-orchestrator'
import { flushLangfuse, initLangfuse } from '@/lib/observability/langfuse'

const payloadSchema = z.strictObject({
  processingJobId: z.uuid(),
})

export const analyzeMeetingTask = task({
  id: 'analyze-meeting',
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
    try {
      for (;;) {
        const result = await runMeetingAnalysisOrchestration({
          processingJobId: parsed.processingJobId,
          workerId: `trigger:${ctx.run.id}`,
          signal,
        })
        if (!result.retryScheduled) return result

        const retryAt = result.retryAt
          ? new Date(result.retryAt)
          : new Date(Date.now() + 5_000)
        await wait.until({ date: retryAt })
        signal.throwIfAborted()
      }
    } finally {
      await flushLangfuse()
    }
  },
})
