import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getFunASRTranscriptionJob,
  parseFunASRRetryAfter,
  parseFunASRTranscriptionJob,
  resolveFunASRJobUrl,
} from '@/lib/meetings/funasr-client'

function validJob() {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    status: 'queued',
    stage: 'queued',
    attempt: 0,
    recovery_count: 0,
    created_at: '2026-07-30T00:00:00+00:00',
    updated_at: '2026-07-30T00:00:00+00:00',
    started_at: null,
    completed_at: null,
    input: {
      filename: 'meeting.webm',
      content_type: 'audio/webm',
      size_bytes: 123,
      sha256: 'a'.repeat(64),
    },
    config: {
      model: 'paraformer-zh',
      language: 'zh',
      hotwords: [],
      diarize: true,
      speaker_count: null,
    },
    result: null,
    error: null,
  }
}

describe('FunASR client contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.FUNASR_BASE_URL
    delete process.env.FUNASR_SERVICE_TOKEN
  })

  it('parses a queued job response', () => {
    expect(parseFunASRTranscriptionJob(validJob()).status).toBe('queued')
  })

  it('rejects malformed timestamps and job states', () => {
    expect(() => parseFunASRTranscriptionJob({ ...validJob(), status: 'processing' })).toThrow()
  })

  it('parses integer Retry-After seconds only', () => {
    expect(parseFunASRRetryAfter('10')).toBe(10)
    expect(parseFunASRRetryAfter('1.5')).toBeNull()
    expect(parseFunASRRetryAfter(null)).toBeNull()
  })

  it('reports the provider origin and network cause when fetch fails', async () => {
    process.env.FUNASR_BASE_URL = 'http://127.0.0.1:8100'
    process.env.FUNASR_SERVICE_TOKEN = 'test-token'
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8100'), {
      code: 'ECONNREFUSED',
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause })))

    await expect(getFunASRTranscriptionJob(
      '550e8400-e29b-41d4-a716-446655440000',
    )).rejects.toMatchObject({
      name: 'FunASRConnectionError',
      code: 'ECONNREFUSED',
      message: expect.stringContaining(
        '无法连接 FunASR 服务 http://127.0.0.1:8100（ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:8100）',
      ),
    })
  })

  it('builds the provider query URL under the configured origin', () => {
    expect(resolveFunASRJobUrl(
      'https://funasr.internal/base',
      '550e8400-e29b-41d4-a716-446655440000',
    ).toString()).toBe(
      'https://funasr.internal/internal/v1/transcription-jobs/550e8400-e29b-41d4-a716-446655440000',
    )
  })
})
