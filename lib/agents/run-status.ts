export const AGENT_RUN_POLL_INTERVAL_MS = 2_000
export const AGENT_RUN_MAX_QUEUE_WAIT_MS = 60_000

export function queuedRunError(status: string | undefined, queuedForMs: number): string | null {
  if (queuedForMs < AGENT_RUN_MAX_QUEUE_WAIT_MS) return null

  if (status === 'PENDING_VERSION') {
    return 'Trigger.dev 尚未注册 generate-estimate 任务版本。请启动本地 Trigger worker 或部署任务后重试。'
  }
  if (status === 'QUEUED' || status === 'DELAYED') {
    return '后台估算任务长时间停留在队列中。当前环境没有可用的 Trigger.dev worker，请启动 pnpm trigger:dev 或部署任务后重试。'
  }
  return null
}
