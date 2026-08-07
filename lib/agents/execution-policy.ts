import type { RunnableConfig } from '@langchain/core/runnables'

export const EXECUTION_POLICY = {
  presalesRouteTimeoutMs: 280_000,
  presalesWorkerTimeoutMs: 13_800_000,
  workflowNodeTimeoutMs: 600_000,
  chatTimeoutMs: 105_000,
  embeddingTimeoutMs: 15_000,
  aiMaxRetries: 1,
  embeddingMaxRetries: 1,
} as const

export interface WorkflowRunOptions {
  executionId?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export class ExecutionTimeoutError extends Error {
  constructor(message = '执行超时') {
    super(message)
    this.name = 'TimeoutError'
  }
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true

  return error instanceof Error && (
    error.name === 'AbortError' ||
    error.name === 'TimeoutError'
  )
}

export function isTimeoutError(error: unknown, signal?: AbortSignal): boolean {
  const reason = signal?.aborted ? signal.reason : error
  return reason instanceof Error && reason.name === 'TimeoutError'
}

export function getErrorMessage(error: unknown, fallback = '未知错误'): string {
  return error instanceof Error ? error.message : fallback
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return

  if (signal.reason instanceof Error) {
    throw signal.reason
  }

  throw new DOMException('操作已取消', 'AbortError')
}

export interface ManagedAbortSignal {
  signal: AbortSignal
  dispose: () => void
}

export function createManagedAbortSignal(
  signals: Array<AbortSignal | undefined>,
  timeoutMs?: number
): ManagedAbortSignal {
  const controller = new AbortController()
  const cleanups: Array<() => void> = []

  const abortFrom = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason)
    }
  }

  for (const signal of signals) {
    if (!signal) continue

    if (signal.aborted) {
      abortFrom(signal)
      break
    }

    const onAbort = () => abortFrom(signal)
    signal.addEventListener('abort', onAbort, { once: true })
    cleanups.push(() => signal.removeEventListener('abort', onAbort))
  }

  let timeout: ReturnType<typeof setTimeout> | undefined
  if (!controller.signal.aborted && timeoutMs && timeoutMs > 0) {
    timeout = setTimeout(() => {
      controller.abort(new ExecutionTimeoutError(`执行超过 ${timeoutMs}ms`))
    }, timeoutMs)
  }

  return {
    signal: controller.signal,
    dispose: () => {
      if (timeout) clearTimeout(timeout)
      cleanups.forEach((cleanup) => cleanup())
    },
  }
}

export async function withAbortSignal<T>(
  signals: Array<AbortSignal | undefined>,
  timeoutMs: number | undefined,
  callback: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const managed = createManagedAbortSignal(signals, timeoutMs)

  try {
    throwIfAborted(managed.signal)
    return await callback(managed.signal)
  } finally {
    managed.dispose()
  }
}

export function getRunnableSignal(config?: RunnableConfig): AbortSignal | undefined {
  return config?.signal
}
