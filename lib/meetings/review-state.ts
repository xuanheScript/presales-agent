import type {
  MeetingAnalysisReviewData,
  MeetingInsightReviewStatus,
} from '@/types'

export type ReviewAction = 'save' | 'accept' | 'exclude'

export function reviewActionState(
  reviewStatus: MeetingInsightReviewStatus,
  isDirty: boolean,
) {
  return {
    saveDisabled: !isDirty,
    acceptDisabled: reviewStatus === 'accepted',
    excludeDisabled: reviewStatus === 'excluded',
    acceptLabel: reviewStatus === 'accepted' ? '已接受' : '接受',
    excludeLabel: reviewStatus === 'excluded' ? '已排除' : '排除',
  }
}

export function updateMeetingInsightReviewState(
  review: MeetingAnalysisReviewData,
  itemId: string,
  reviewStatus: MeetingInsightReviewStatus,
  versionUpdatedAt?: string,
): MeetingAnalysisReviewData {
  return {
    ...review,
    version: versionUpdatedAt
      ? { ...review.version, updated_at: versionUpdatedAt }
      : review.version,
    items: review.items.map((item) => item.id === itemId
      ? { ...item, review_status: reviewStatus }
      : item),
  }
}
