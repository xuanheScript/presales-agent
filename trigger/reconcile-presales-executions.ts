import { schedules } from '@trigger.dev/sdk'
import { createAdminClient } from '@/lib/supabase/admin'

export const reconcilePresalesExecutionsTask = schedules.task({
  id: 'reconcile-presales-executions',
  cron: '*/5 * * * *',
  maxDuration: 300,
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 2_000,
    maxTimeoutInMs: 30_000,
    factor: 2,
    randomize: true,
  },
  run: async () => {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('reconcile_stale_presales_executions', {
      p_stale_after_seconds: 900,
      p_batch_size: 100,
    })

    if (error) {
      throw new Error(`巡检售前执行终态失败: ${error.message}`)
    }

    return { reconciled: Number(data || 0) }
  },
})
