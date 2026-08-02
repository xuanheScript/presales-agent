import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import {
  normalizedTranscriptText,
  transcriptReviewContentHash,
} from '@/lib/meetings/service'

describe('transcript review persistence', () => {
  it('normalizes segment text into the persisted full transcript', () => {
    expect(normalizedTranscriptText([
      { text: '  第一段。 ' },
      { text: '第二段。\n' },
    ])).toBe('第一段。\n第二段。')
  })

  it('creates a stable UTF-8 digest for a reviewed transcript', () => {
    expect(transcriptReviewContentHash('需求确认。')).toBe(
      'f7e1486b206876a04d2a72d9757c7649ff483c331cf64051f021cb7be3eda3d7',
    )
  })
})
