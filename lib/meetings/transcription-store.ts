import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type { FunASRTranscriptionResult } from '@/lib/meetings/funasr-client'

export interface ClaimedTranscriptionJob {
  jobId: string
  projectId: string
  meetingId: string
  mediaAssetId: string
  bucket: string
  objectPath: string
  originalFilename: string
  mimeType: string
  sizeBytes: number
  sha256: string
  leaseToken: string
  eventSequence: number
  attempt: number
  maxAttempts: number
  providerTaskId: string | null
}

export interface TranscriptionFailureResult {
  status: 'queued' | 'failed'
  retryScheduled: boolean
  nextPollAt: string | null
}

function claimedJob(row: Record<string, unknown>): ClaimedTranscriptionJob {
  return {
    jobId: String(row.job_id),
    projectId: String(row.project_id),
    meetingId: String(row.meeting_id),
    mediaAssetId: String(row.media_asset_id),
    bucket: String(row.bucket),
    objectPath: String(row.object_path),
    originalFilename: String(row.original_filename),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    sha256: String(row.sha256),
    leaseToken: String(row.lease_token),
    eventSequence: Number(row.event_sequence),
    attempt: Number(row.attempt),
    maxAttempts: Number(row.max_attempts),
    providerTaskId: row.provider_task_id == null ? null : String(row.provider_task_id),
  }
}

export async function claimTranscriptionJob(
  jobId: string,
  workerId: string,
): Promise<ClaimedTranscriptionJob | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('claim_transcription_job', {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_lease_seconds: 300,
  })
  if (error) throw new Error(`领取转写任务失败: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : null
  return row ? claimedJob(row as Record<string, unknown>) : null
}

export async function updateTranscriptionJobProgress(input: {
  jobId: string
  leaseToken: string
  stage: string
  progressPercent: number
  providerTaskId?: string
}): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.rpc('update_transcription_job_progress', {
    p_job_id: input.jobId,
    p_lease_token: input.leaseToken,
    p_stage: input.stage,
    p_progress_percent: input.progressPercent,
    p_provider_task_id: input.providerTaskId ?? null,
    p_lease_seconds: 300,
  })
  if (error) throw new Error(`更新转写任务进度失败: ${error.message}`)
}

export async function finishOrRetryTranscriptionJob(input: {
  jobId: string
  leaseToken: string
  errorCode: string
  errorMessage: string
  retryable: boolean
  retryAfterSeconds?: number | null
}): Promise<TranscriptionFailureResult> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('finish_or_retry_transcription_job', {
    p_job_id: input.jobId,
    p_lease_token: input.leaseToken,
    p_error_code: input.errorCode,
    p_error_message: input.errorMessage,
    p_retryable: input.retryable,
    p_retry_after_seconds: input.retryAfterSeconds ?? null,
  })
  const row = Array.isArray(data) ? data[0] : null
  if (error || !row) {
    throw new Error(`结束转写任务失败: ${error?.message ?? 'RPC 未返回任务状态'}`)
  }
  return {
    status: row.status === 'queued' ? 'queued' : 'failed',
    retryScheduled: Boolean(row.retry_scheduled),
    nextPollAt: row.next_poll_at == null ? null : String(row.next_poll_at),
  }
}

export function transcriptContentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function transcriptionSegments(result: FunASRTranscriptionResult) {
  return result.segments.map((segment, sequenceNo) => ({
    sequenceNo,
    speakerKey: segment.speaker ?? (
      segment.speaker_id == null ? null : `speaker_${String(segment.speaker_id)}`
    ),
    startMs: segment.start_ms,
    endMs: segment.end_ms,
    text: segment.text,
    confidence: null,
    words: segment.tokens.map((token) => ({
      text: token.text,
      startMs: token.start_ms,
      endMs: token.end_ms,
    })),
  }))
}

export async function commitTranscriptionJob(input: {
  job: ClaimedTranscriptionJob
  providerTaskId: string
  result: FunASRTranscriptionResult
  configVersion: string
}): Promise<string> {
  const supabase = createAdminClient()
  const modelManifest = {
    processingJobId: input.job.jobId,
    provider: 'funasr',
    providerTaskId: input.providerTaskId,
    configVersion: input.configVersion,
    model: input.result.model,
    alignment: input.result.alignment,
    warnings: input.result.warnings,
    language: input.result.language,
    durationSeconds: input.result.duration,
    processingTimeSeconds: input.result.processing_time,
    rtf: input.result.rtf,
  }
  const { data, error } = await supabase.rpc('commit_transcription_job', {
    p_job_id: input.job.jobId,
    p_lease_token: input.job.leaseToken,
    p_full_text: input.result.text,
    p_content_hash: transcriptContentHash(input.result.text),
    p_model_manifest: modelManifest,
    p_config_version: input.configVersion,
    p_segments: transcriptionSegments(input.result),
  })
  if (error || typeof data !== 'string') {
    throw new Error(`保存机器转写稿失败: ${error?.message ?? 'RPC 未返回版本 ID'}`)
  }
  return data
}
