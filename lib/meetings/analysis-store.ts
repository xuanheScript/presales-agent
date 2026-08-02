import { createAdminClient } from '@/lib/supabase/admin'
import { ANALYSIS_LEASE_SECONDS } from '@/lib/meetings/analysis-chunking'
import type {
  MeetingAnalysisItem,
  MeetingAnalysisResult,
  MeetingAnalysisTranscriptSegment,
} from '@/lib/meetings/analysis-schema'

export interface ClaimedMeetingAnalysisJob {
  jobId: string
  projectId: string
  meetingId: string
  transcriptRevisionId: string
  transcriptContentHash: string
  modelId: string
  promptVersion: string
  schemaVersion: string
  configVersion: string
  leaseToken: string
  eventSequence: number
  attempt: number
  maxAttempts: number
}

export interface MeetingAnalysisFailureResult {
  status: 'queued' | 'failed'
  retryScheduled: boolean
  nextPollAt: string | null
}

function claimedJob(row: Record<string, unknown>): ClaimedMeetingAnalysisJob {
  return {
    jobId: String(row.job_id),
    projectId: String(row.project_id),
    meetingId: String(row.meeting_id),
    transcriptRevisionId: String(row.transcript_revision_id),
    transcriptContentHash: String(row.transcript_content_hash),
    modelId: String(row.model_id),
    promptVersion: String(row.prompt_version),
    schemaVersion: String(row.schema_version),
    configVersion: String(row.config_version),
    leaseToken: String(row.lease_token),
    eventSequence: Number(row.event_sequence),
    attempt: Number(row.attempt),
    maxAttempts: Number(row.max_attempts),
  }
}

export async function claimMeetingAnalysisJob(
  jobId: string,
  workerId: string,
): Promise<ClaimedMeetingAnalysisJob | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('claim_meeting_analysis_job', {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_lease_seconds: ANALYSIS_LEASE_SECONDS,
  })
  if (error) throw new Error(`领取会议分析任务失败: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : null
  return row ? claimedJob(row as Record<string, unknown>) : null
}

export async function loadMeetingAnalysisTranscript(
  job: ClaimedMeetingAnalysisJob,
): Promise<MeetingAnalysisTranscriptSegment[]> {
  const supabase = createAdminClient()
  const { data: revision, error: revisionError } = await supabase
    .from('transcript_revisions')
    .select('id,project_id,meeting_id,kind,status,content_hash')
    .eq('id', job.transcriptRevisionId)
    .eq('project_id', job.projectId)
    .eq('meeting_id', job.meetingId)
    .eq('kind', 'human')
    .eq('status', 'approved')
    .maybeSingle()
  if (revisionError || !revision || revision.content_hash !== job.transcriptContentHash) {
    throw new MeetingAnalysisStoreError(
      'TRANSCRIPT_SOURCE_CHANGED',
      '会议分析来源转写版本无效或内容摘要已变化',
      false,
    )
  }

  const { data, error } = await supabase
    .from('transcript_segments')
    .select('id,sequence_no,speaker_key,start_ms,end_ms,text')
    .eq('project_id', job.projectId)
    .eq('meeting_id', job.meetingId)
    .eq('transcript_revision_id', job.transcriptRevisionId)
    .order('sequence_no')
  if (error) {
    throw new MeetingAnalysisStoreError(
      'TRANSCRIPT_READ_FAILED',
      '读取批准稿片段失败',
      true,
    )
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    sequenceNo: row.sequence_no,
    speakerKey: row.speaker_key,
    startMs: row.start_ms,
    endMs: row.end_ms,
    text: row.text,
  }))
}

export async function updateMeetingAnalysisJobProgress(input: {
  jobId: string
  leaseToken: string
  stage: string
  progressPercent: number
}): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.rpc('update_meeting_analysis_job_progress', {
    p_job_id: input.jobId,
    p_lease_token: input.leaseToken,
    p_stage: input.stage,
    p_progress_percent: input.progressPercent,
    p_lease_seconds: ANALYSIS_LEASE_SECONDS,
  })
  if (error) throw new Error(`更新会议分析任务进度失败: ${error.message}`)
}

export async function finishOrRetryMeetingAnalysisJob(input: {
  jobId: string
  leaseToken: string
  errorCode: string
  errorMessage: string
  retryable: boolean
  retryAfterSeconds?: number | null
}): Promise<MeetingAnalysisFailureResult> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('finish_or_retry_meeting_analysis_job', {
    p_job_id: input.jobId,
    p_lease_token: input.leaseToken,
    p_error_code: input.errorCode,
    p_error_message: input.errorMessage,
    p_retryable: input.retryable,
    p_retry_after_seconds: input.retryAfterSeconds ?? null,
  })
  const row = Array.isArray(data) ? data[0] : null
  if (error || !row) {
    throw new Error(`结束会议分析任务失败: ${error?.message ?? 'RPC 未返回任务状态'}`)
  }
  return {
    status: row.status === 'queued' ? 'queued' : 'failed',
    retryScheduled: Boolean(row.retry_scheduled),
    nextPollAt: row.next_poll_at == null ? null : String(row.next_poll_at),
  }
}

export async function commitMeetingAnalysisJob(input: {
  job: ClaimedMeetingAnalysisJob
  result: MeetingAnalysisResult
  modelManifest: Record<string, unknown>
}): Promise<string> {
  const supabase = createAdminClient()
  const items = input.result.items.map((item: MeetingAnalysisItem) => ({
    category: item.category,
    title: item.title,
    description: item.description,
    evidenceSegmentIds: item.evidenceSegmentIds,
  }))
  const { data, error } = await supabase.rpc('commit_meeting_analysis_job', {
    p_job_id: input.job.jobId,
    p_lease_token: input.job.leaseToken,
    p_summary: input.result.summary,
    p_model_manifest: input.modelManifest,
    p_items: items,
  })
  if (error || typeof data !== 'string') {
    throw new Error(`保存会议分析版本失败: ${error?.message ?? 'RPC 未返回版本 ID'}`)
  }
  return data
}

export class MeetingAnalysisStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'MeetingAnalysisStoreError'
  }
}
