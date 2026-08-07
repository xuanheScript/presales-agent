import { describe, expect, it } from 'vitest'
import type { MeetingAnalysisReviewData } from '@/types'
import {
  reviewActionState,
  updateMeetingInsightReviewState,
} from '@/lib/meetings/review-state'

const review = {
  version: {
    id: 'version-1',
    updated_at: '2026-07-31T08:21:39.558157+00:00',
  },
  items: [
    { id: 'item-1', review_status: 'pending' },
    { id: 'item-2', review_status: 'pending' },
  ],
} as MeetingAnalysisReviewData

describe('meeting insight review actions', () => {
  it('only enables save when the item has unsaved edits', () => {
    expect(reviewActionState('pending', false).saveDisabled).toBe(true)
    expect(reviewActionState('pending', true).saveDisabled).toBe(false)
  })

  it('marks the current review action as selected and keeps the opposite transition available', () => {
    expect(reviewActionState('accepted', false)).toMatchObject({
      acceptDisabled: true,
      acceptLabel: '已接受',
      excludeDisabled: false,
      excludeLabel: '排除',
    })
    expect(reviewActionState('excluded', false)).toMatchObject({
      acceptDisabled: false,
      acceptLabel: '接受',
      excludeDisabled: true,
      excludeLabel: '已排除',
    })
  })
})

describe('meeting insight review state', () => {
  it('preserves the accepted status when the server timestamp arrives', () => {
    const updated = updateMeetingInsightReviewState(
      review,
      'item-1',
      'accepted',
      '2026-07-31T08:21:59.414026+00:00',
    )

    expect(updated.version.updated_at).toBe('2026-07-31T08:21:59.414026+00:00')
    expect(updated.items[0].review_status).toBe('accepted')
    expect(updated.items[1].review_status).toBe('pending')
  })

  it('can optimistically update the item without changing the version token', () => {
    const updated = updateMeetingInsightReviewState(review, 'item-1', 'excluded')

    expect(updated.version.updated_at).toBe(review.version.updated_at)
    expect(updated.items[0].review_status).toBe('excluded')
  })
})
