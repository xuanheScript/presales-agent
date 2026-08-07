import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import {
  transcriptContentHash,
  transcriptionSegments,
} from '@/lib/meetings/transcription-store'
import type { FunASRTranscriptionResult } from '@/lib/meetings/funasr-client'

const result: FunASRTranscriptionResult = {
  task: 'transcribe',
  language: 'zh',
  duration: 1,
  text: '需求确认。',
  raw_text: '需 求 确 认',
  tokens: [],
  segments: [{
    id: 0,
    start_ms: 100,
    end_ms: 900,
    text: '需求确认。',
    speaker: 'speaker_0',
    speaker_id: 0,
    tokens: [{ text: '需求', start_ms: 100, end_ms: 300 }],
  }],
  alignment: { status: 'aligned', token_count: 1, timestamp_count: 1 },
  model: {
    service_version: 'v1',
    asr_model: 'paraformer-zh',
    vad_model: 'fsmn-vad',
    punctuation_model: 'ct-punc',
    speaker_model: 'cam++',
    model_revision: 'fixed-revision',
    device: 'cpu',
    timestamp_source: 'model',
    speaker_scope: 'recording',
  },
  processing_time: 0.5,
  rtf: 0.5,
  warnings: [],
}

describe('transcription persistence mapping', () => {
  it('creates a stable UTF-8 content digest', () => {
    expect(transcriptContentHash('需求确认。')).toBe(
      'f7e1486b206876a04d2a72d9757c7649ff483c331cf64051f021cb7be3eda3d7',
    )
  })

  it('maps provider segments without inventing confidence', () => {
    expect(transcriptionSegments(result)).toEqual([{
      sequenceNo: 0,
      speakerKey: 'speaker_0',
      startMs: 100,
      endMs: 900,
      text: '需求确认。',
      confidence: null,
      words: [{ text: '需求', startMs: 100, endMs: 300 }],
    }])
  })
})
