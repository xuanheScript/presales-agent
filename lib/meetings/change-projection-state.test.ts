import { describe, expect, it } from 'vitest'
import {
  dispositionLabels,
  isDecisionRequired,
  mappingStatusLabels,
  projectionApplyState,
  projectionOperations,
  requiresTargetEntry,
} from '@/lib/meetings/change-projection-state'

describe('requirement change projection labels', () => {
  it('uses requirement update terminology', () => {
    expect(mappingStatusLabels).toEqual({
      auto_mapped: '系统已建议',
      decision_required: '需要确认',
      ready: '已确认',
    })
    expect(dispositionLabels).toEqual({
      include: '更新项目需求',
      omit: '本次不更新',
    })
  })

  it('only treats decision_required as awaiting a human decision', () => {
    expect(isDecisionRequired('decision_required')).toBe(true)
    expect(isDecisionRequired('auto_mapped')).toBe(false)
    expect(isDecisionRequired('ready')).toBe(false)
  })
})

describe('requirement change projection operations', () => {
  it('hides replace and remove for an initial baseline', () => {
    expect(projectionOperations(true)).toEqual(['add', 'note'])
  })

  it('offers all operations for an incremental change', () => {
    expect(projectionOperations(false)).toEqual(['add', 'replace', 'remove', 'note'])
  })

  it('requires a target only for included replace or remove projections', () => {
    expect(requiresTargetEntry('include', 'replace')).toBe(true)
    expect(requiresTargetEntry('include', 'remove')).toBe(true)
    expect(requiresTargetEntry('include', 'add')).toBe(false)
    expect(requiresTargetEntry('omit', 'replace')).toBe(false)
    expect(requiresTargetEntry('omit', 'remove')).toBe(false)
  })
})

describe('requirement change projection apply state', () => {
  const readyItems = [
    { mapping_status: 'auto_mapped' as const, disposition: 'include' as const },
    { mapping_status: 'ready' as const, disposition: 'omit' as const },
  ]

  it('allows auto-mapped and confirmed items to apply without a per-item click', () => {
    expect(projectionApplyState({
      items: readyItems,
      dirtyCount: 0,
      pendingRequestCount: 0,
      conflict: false,
    })).toEqual({
      decisionRequiredCount: 0,
      includedCount: 1,
      conflictingTargetCount: 0,
      canApply: true,
    })
  })

  it('blocks multiple included mutations targeting the same baseline entry', () => {
    const conflictItems = [
      {
        mapping_status: 'ready' as const,
        disposition: 'include' as const,
        operation: 'replace' as const,
        target_path: 'requirements',
        target_entry_id: 'entry-1',
      },
      {
        mapping_status: 'ready' as const,
        disposition: 'include' as const,
        operation: 'remove' as const,
        target_path: 'requirements',
        target_entry_id: 'entry-1',
      },
    ]

    expect(projectionApplyState({
      items: conflictItems,
      dirtyCount: 0,
      pendingRequestCount: 0,
      conflict: false,
    })).toMatchObject({
      conflictingTargetCount: 1,
      canApply: false,
    })
  })

  it.each([
    ['a decision is still required', [{ mapping_status: 'decision_required' as const, disposition: 'include' as const }], 0, 0, false],
    ['nothing is included', [{ mapping_status: 'ready' as const, disposition: 'omit' as const }], 0, 0, false],
    ['an item is dirty', readyItems, 1, 0, false],
    ['a request is pending', readyItems, 0, 1, false],
    ['a conflict exists', readyItems, 0, 0, true],
  ])('blocks applying when %s', (_reason, items, dirtyCount, pendingRequestCount, conflict) => {
    expect(projectionApplyState({
      items,
      dirtyCount,
      pendingRequestCount,
      conflict,
    }).canApply).toBe(false)
  })
})
