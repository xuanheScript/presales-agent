import { PresalesExecutionError } from './execution-errors'
import type { PresalesState, WorkflowResult } from './state'

export interface AgentSseEvent {
  event: 'progress' | 'complete' | 'error'
  data: unknown
}

export function encodeSseEvent(event: AgentSseEvent): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`
  )
}

export function createPendingWorkflowResult(): WorkflowResult {
  return {
    success: false,
    analysis: null,
    functions: [],
    identifiedRoles: [],
    additionalWork: [],
    estimation: null,
    cost: null,
    error: null,
  }
}

export function accumulateWorkflowUpdate(
  current: WorkflowResult,
  state: Partial<PresalesState>
): WorkflowResult {
  return {
    success: Boolean(state.isComplete ?? current.success) && !(state.error ?? current.error),
    analysis: state.analysis === undefined ? current.analysis : state.analysis || null,
    functions: state.functions ?? current.functions,
    identifiedRoles: state.identifiedRoles ?? current.identifiedRoles,
    additionalWork: state.additionalWork ?? current.additionalWork,
    estimation: state.estimation === undefined ? current.estimation : state.estimation || null,
    cost: state.cost === undefined ? current.cost : state.cost || null,
    error: state.error === undefined ? current.error : state.error || null,
  }
}

export function assertCompletedWorkflowResult(result: WorkflowResult): void {
  if (result.error) {
    throw new PresalesExecutionError(result.error, 500)
  }
  if (!result.success) {
    throw new PresalesExecutionError('工作流未完整结束', 500)
  }
}

export async function createCompleteEventAfterCommit(
  executionId: string,
  result: WorkflowResult,
  commit: (result: WorkflowResult) => Promise<string>
): Promise<AgentSseEvent> {
  assertCompletedWorkflowResult(result)
  const estimateVersionId = await commit(result)

  return {
    event: 'complete',
    data: {
      success: true,
      executionId,
      estimateVersionId,
      data: result,
    },
  }
}
