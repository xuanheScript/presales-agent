import {
  isAbortError,
  isTimeoutError,
} from './execution-policy'

export type PresalesExecutionTerminalStatus = 'failed' | 'cancelled' | 'timed_out'

export class PresalesExecutionError extends Error {
  constructor(
    message: string,
    readonly status: number = 500,
    readonly code = 'PRESALES_EXECUTION_ERROR'
  ) {
    super(message)
    this.name = 'PresalesExecutionError'
  }
}

export function classifyExecutionError(
  error: unknown,
  signal?: AbortSignal
): PresalesExecutionTerminalStatus {
  if (isTimeoutError(error, signal)) return 'timed_out'
  if (isAbortError(error, signal)) return 'cancelled'
  return 'failed'
}
