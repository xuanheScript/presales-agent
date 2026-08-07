import { describe, expect, it } from 'vitest'
import {
  chunkTranscriptSegments,
  MeetingAnalysisValidationError,
  mergeMeetingAnalysisItems,
  validateChunkAnalysis,
} from '@/lib/meetings/analysis-chunking'
import type { MeetingAnalysisTranscriptSegment } from '@/lib/meetings/analysis-schema'

function segment(
  id: string,
  sequenceNo: number,
  text: string,
): MeetingAnalysisTranscriptSegment {
  return {
    id,
    sequenceNo,
    speakerKey: `speaker_${sequenceNo % 2}`,
    startMs: sequenceNo * 1_000,
    endMs: sequenceNo * 1_000 + 900,
    text,
  }
}

describe('meeting analysis chunking and evidence validation', () => {
  it('keeps transcript segments intact and creates stable source IDs', () => {
    const segments = [
      segment('00000000-0000-4000-8000-000000000001', 0, '需要支持会议录音。'),
      segment('00000000-0000-4000-8000-000000000002', 1, '决定先完成转写校对。'),
    ]

    const first = chunkTranscriptSegments(segments)
    const second = chunkTranscriptSegments(segments)

    expect(first).toHaveLength(1)
    expect(first[0].segments.map((item) => item.id)).toEqual(segments.map((item) => item.id))
    expect(first[0].sourceId).toMatch(/^CHUNK-[A-F0-9]{20}$/)
    expect(second[0].sourceId).toBe(first[0].sourceId)
  })

  it('rejects evidence from another chunk or transcript revision', () => {
    const [chunk] = chunkTranscriptSegments([
      segment('00000000-0000-4000-8000-000000000001', 0, '需要支持会议录音。'),
    ])

    expect(() => validateChunkAnalysis(chunk, {
      sourceId: chunk.sourceId,
      coverageStatus: 'insights',
      items: [{
        category: 'requirement',
        title: '会议录音',
        description: '系统需要支持会议录音。',
        evidenceSegmentIds: ['00000000-0000-4000-8000-000000000099'],
      }],
    })).toThrowError(expect.objectContaining({ code: 'EVIDENCE_OUTSIDE_CHUNK' }))
  })

  it('rejects duplicate evidence IDs', () => {
    const evidenceId = '00000000-0000-4000-8000-000000000001'
    const [chunk] = chunkTranscriptSegments([segment(evidenceId, 0, '确认使用 FunASR。')])

    expect(() => validateChunkAnalysis(chunk, {
      sourceId: chunk.sourceId,
      coverageStatus: 'insights',
      items: [{
        category: 'decision',
        title: '采用 FunASR',
        description: '会议确认采用 FunASR。',
        evidenceSegmentIds: [evidenceId, evidenceId],
      }],
    })).toThrowError(expect.objectContaining({ code: 'DUPLICATE_EVIDENCE' }))
  })

  it('rejects coverage declarations that hide or invent items', () => {
    const [chunk] = chunkTranscriptSegments([
      segment('00000000-0000-4000-8000-000000000001', 0, '闲聊。'),
    ])

    expect(() => validateChunkAnalysis(chunk, {
      sourceId: chunk.sourceId,
      coverageStatus: 'no_insights',
      items: [{
        category: 'risk',
        title: '虚构风险',
        description: '没有证据的风险。',
        evidenceSegmentIds: ['00000000-0000-4000-8000-000000000001'],
      }],
    })).toThrowError(MeetingAnalysisValidationError)
  })

  it('deterministically merges exact repeated insights and evidence', () => {
    const result = mergeMeetingAnalysisItems([
      {
        category: 'requirement',
        title: '支持录音',
        description: '支持网页录音。',
        evidenceSegmentIds: ['00000000-0000-4000-8000-000000000001'],
      },
      {
        category: 'requirement',
        title: '支持录音',
        description: '支持网页录音。',
        evidenceSegmentIds: ['00000000-0000-4000-8000-000000000002'],
      },
    ])

    expect(result).toEqual([{
      category: 'requirement',
      title: '支持录音',
      description: '支持网页录音。',
      evidenceSegmentIds: [
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
      ],
    }])
  })
})
