import { openAsBlob } from 'node:fs'
import { z } from 'zod'

const tokenTimestampSchema = z.object({
  text: z.string(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
}).refine((token) => token.end_ms >= token.start_ms, 'token end precedes start')

const transcriptSegmentSchema = z.object({
  id: z.number().int().nonnegative(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  text: z.string(),
  speaker: z.string().nullable().optional(),
  speaker_id: z.union([z.number(), z.string()]).nullable().optional(),
  tokens: z.array(tokenTimestampSchema),
}).refine((segment) => segment.end_ms >= segment.start_ms, 'segment end precedes start')

const transcriptionResultSchema = z.object({
  task: z.literal('transcribe'),
  language: z.string(),
  duration: z.number().nonnegative(),
  text: z.string(),
  raw_text: z.string().nullable().optional(),
  tokens: z.array(tokenTimestampSchema),
  segments: z.array(transcriptSegmentSchema),
  alignment: z.object({
    status: z.enum(['aligned', 'mismatch', 'unavailable']),
    token_count: z.number().int().nonnegative(),
    timestamp_count: z.number().int().nonnegative(),
  }),
  model: z.object({
    service_version: z.string(),
    asr_model: z.string(),
    vad_model: z.string(),
    punctuation_model: z.string(),
    speaker_model: z.string().nullable().optional(),
    model_revision: z.string(),
    device: z.string(),
    timestamp_source: z.enum(['model', 'unavailable']),
    speaker_scope: z.enum(['recording', 'none']),
  }),
  processing_time: z.number().nonnegative(),
  rtf: z.number().nonnegative(),
  warnings: z.array(z.string()),
})

const jobErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  occurred_at: z.string(),
})

export const transcriptionJobSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  stage: z.string(),
  attempt: z.number().int().nonnegative(),
  recovery_count: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  input: z.object({
    filename: z.string(),
    content_type: z.string(),
    size_bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  config: z.object({
    model: z.string(),
    language: z.string(),
    hotwords: z.array(z.string()),
    diarize: z.boolean(),
    speaker_count: z.number().int().positive().nullable(),
  }),
  result: transcriptionResultSchema.nullable(),
  error: jobErrorSchema.nullable(),
})

export type FunASRTranscriptionJob = z.infer<typeof transcriptionJobSchema>
export type FunASRTranscriptionResult = z.infer<typeof transcriptionResultSchema>

export class FunASRHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds: number | null,
  ) {
    super(message)
    this.name = 'FunASRHttpError'
  }
}

export class FunASRConnectionError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'FunASRConnectionError'
  }
}

export function parseFunASRTranscriptionJob(value: unknown): FunASRTranscriptionJob {
  return transcriptionJobSchema.parse(value)
}

export function parseFunASRRetryAfter(value: string | null): number | null {
  return value && /^\d+$/.test(value) ? Number(value) : null
}

export function resolveFunASRJobUrl(baseUrl: string | URL, jobId: string): URL {
  return new URL(`/internal/v1/transcription-jobs/${encodeURIComponent(jobId)}`, baseUrl)
}

function config() {
  const baseUrl = process.env.FUNASR_BASE_URL
  const token = process.env.FUNASR_SERVICE_TOKEN
  if (!baseUrl || !token) {
    throw new Error('后台转写需要配置 FUNASR_BASE_URL 和 FUNASR_SERVICE_TOKEN')
  }
  return { baseUrl: new URL(baseUrl), token }
}

async function errorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { detail?: unknown } | null
  if (typeof body?.detail === 'string') return body.detail
  if (Array.isArray(body?.detail)) {
    return body.detail
      .map((entry) => typeof entry === 'object' && entry && 'msg' in entry ? String(entry.msg) : String(entry))
      .join('; ')
  }
  return `FunASR HTTP ${response.status}`
}

function connectionCause(error: unknown): { code: string | null; message: string } {
  if (!(error instanceof Error) || !('cause' in error)) {
    return { code: null, message: error instanceof Error ? error.message : String(error) }
  }
  const cause = error.cause
  if (!(cause instanceof Error)) {
    return { code: null, message: error.message }
  }
  const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : null
  return { code, message: cause.message }
}

async function requestJob(url: URL, init: RequestInit): Promise<FunASRTranscriptionJob> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    const cause = connectionCause(error)
    const detail = cause.code ? `${cause.code}: ${cause.message}` : cause.message
    throw new FunASRConnectionError(
      `无法连接 FunASR 服务 ${url.origin}（${detail}）`,
      cause.code,
      { cause: error },
    )
  }
  if (!response.ok) {
    const retryAfterSeconds = parseFunASRRetryAfter(response.headers.get('retry-after'))
    throw new FunASRHttpError(await errorMessage(response), response.status, retryAfterSeconds)
  }
  return parseFunASRTranscriptionJob(await response.json())
}

export async function createFunASRTranscriptionJob(input: {
  filePath: string
  filename: string
  contentType: string
  idempotencyKey: string
  language?: string
  hotwords?: string[]
  diarize?: boolean
  speakerCount?: number | null
  signal?: AbortSignal
}): Promise<FunASRTranscriptionJob> {
  const { baseUrl, token } = config()
  const form = new FormData()
  const file = await openAsBlob(input.filePath, { type: input.contentType })
  form.set('file', file, input.filename)
  form.set('model', 'paraformer-zh')
  form.set('language', input.language ?? 'zh')
  form.set('hotwords', JSON.stringify(input.hotwords ?? []))
  form.set('diarize', String(input.diarize ?? true))
  if (input.speakerCount != null) form.set('speaker_count', String(input.speakerCount))

  return requestJob(new URL('/internal/v1/transcription-jobs', baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': input.idempotencyKey,
    },
    body: form,
    signal: input.signal,
  })
}

export async function getFunASRTranscriptionJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<FunASRTranscriptionJob> {
  const { baseUrl, token } = config()
  return requestJob(resolveFunASRJobUrl(baseUrl, jobId), {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
}
