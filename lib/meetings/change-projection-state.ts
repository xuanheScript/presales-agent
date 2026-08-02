import type {
  RequirementChangeDisposition,
  RequirementChangeMappingStatus,
  RequirementChangeOperation,
} from '@/types'

const bootstrapOperations: RequirementChangeOperation[] = ['add', 'note']
const incrementalOperations: RequirementChangeOperation[] = ['add', 'replace', 'remove', 'note']

export const mappingStatusLabels: Record<RequirementChangeMappingStatus, string> = {
  auto_mapped: '系统已建议',
  decision_required: '需要确认',
  ready: '已确认',
}

export const dispositionLabels: Record<RequirementChangeDisposition, string> = {
  include: '更新项目需求',
  omit: '本次不更新',
}

export function isDecisionRequired(mappingStatus: RequirementChangeMappingStatus) {
  return mappingStatus === 'decision_required'
}

export function projectionOperations(isBootstrap: boolean): RequirementChangeOperation[] {
  return isBootstrap ? [...bootstrapOperations] : [...incrementalOperations]
}

export function requiresTargetEntry(
  disposition: RequirementChangeDisposition,
  operation: RequirementChangeOperation,
) {
  return disposition === 'include' && (operation === 'replace' || operation === 'remove')
}

interface ProjectionApplyItem {
  mapping_status: RequirementChangeMappingStatus
  disposition: RequirementChangeDisposition
  operation?: RequirementChangeOperation
  target_path?: string
  target_entry_id?: string | null
}

export interface ProjectionApplyState {
  decisionRequiredCount: number
  includedCount: number
  conflictingTargetCount: number
  canApply: boolean
}

function projectionTargetKey(item: ProjectionApplyItem): string | null {
  if (item.disposition !== 'include'
    || (item.operation !== 'replace' && item.operation !== 'remove')
    || !item.target_path
    || !item.target_entry_id) return null
  return `${item.target_path}:${item.target_entry_id}`
}

export function projectionApplyState({
  items,
  dirtyCount,
  pendingRequestCount,
  conflict,
}: {
  items: ProjectionApplyItem[]
  dirtyCount: number
  pendingRequestCount: number
  conflict: boolean
}): ProjectionApplyState {
  const decisionRequiredCount = items.filter((item) => isDecisionRequired(item.mapping_status)).length
  const includedCount = items.filter((item) => item.disposition === 'include').length
  const targetCounts = new Map<string, number>()
  for (const item of items) {
    const targetKey = projectionTargetKey(item)
    if (targetKey) targetCounts.set(targetKey, (targetCounts.get(targetKey) ?? 0) + 1)
  }
  const conflictingTargetCount = [...targetCounts.values()].filter((count) => count > 1).length

  return {
    decisionRequiredCount,
    includedCount,
    conflictingTargetCount,
    canApply: decisionRequiredCount === 0
      && includedCount > 0
      && conflictingTargetCount === 0
      && dirtyCount === 0
      && pendingRequestCount === 0
      && !conflict,
  }
}
