import { describe, expect, it } from 'vitest'
import {
  AGENT_RUN_MAX_QUEUE_WAIT_MS,
  queuedRunError,
} from '@/lib/agents/run-status'

describe('queued Trigger run diagnostics', () => {
  it('allows a normal short queue wait', () => {
    expect(queuedRunError('QUEUED', AGENT_RUN_MAX_QUEUE_WAIT_MS - 1)).toBeNull()
  })

  it('explains when no Trigger worker consumes a queued run', () => {
    expect(queuedRunError('QUEUED', AGENT_RUN_MAX_QUEUE_WAIT_MS)).toContain('Trigger.dev worker')
  })

  it('explains when the task version is unavailable', () => {
    expect(queuedRunError('PENDING_VERSION', AGENT_RUN_MAX_QUEUE_WAIT_MS)).toContain('任务版本')
  })

  it('does not time out an executing run', () => {
    expect(queuedRunError('EXECUTING', AGENT_RUN_MAX_QUEUE_WAIT_MS * 2)).toBeNull()
  })
})
