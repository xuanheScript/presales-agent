import { createHash } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import {
  MeetingPermissionError,
  requireProjectOwner,
  requireUser,
} from '@/lib/meetings/permissions'
import { MEETING_AUDIO_MIME_TYPES } from '@/lib/storage/meeting-audio'
import type {
  MediaAsset,
  Meeting,
  MeetingAnalysisReviewData,
  MeetingAnalysisVersion,
  MeetingWithLatestState,
  ProcessingJob,
  RequirementBaseline,
  RequirementChangeDisposition,
  RequirementChangeSetReviewData,
  RequirementChangeOperation,
  RequirementChangeTarget,
  TranscriptReviewData,
  TranscriptSegment,
} from '@/types'
import {
  MEETING_ANALYSIS_CONFIG_VERSION,
  MEETING_ANALYSIS_PROMPT_VERSION,
  MEETING_ANALYSIS_SCHEMA_VERSION,
} from '@/lib/meetings/analysis-schema'

const PROCESSING_JOB_PUBLIC_FIELDS =
  'id,project_id,meeting_id,media_asset_id,job_type,status,progress_percent,stage,event_sequence,error_code,error_message,created_at,updated_at,started_at,finished_at'

const TRANSCRIPT_REVISION_PUBLIC_FIELDS =
  'id,project_id,meeting_id,revision_no,parent_revision_id,kind,status,full_text,content_hash,config_version,created_at,updated_at,approved_at'

const TRANSCRIPT_SEGMENT_PUBLIC_FIELDS =
  'id,project_id,meeting_id,transcript_revision_id,sequence_no,speaker_key,start_ms,end_ms,text,confidence,words,source_segment_id,created_at,updated_at'

export interface EditableTranscriptSegment {
  sequenceNo: number
  speakerKey: string | null
  startMs: number
  endMs: number
  text: string
  confidence: number | null
  words: TranscriptSegment['words']
  sourceSegmentId: string | null
}

export class MeetingServiceError extends Error {
  constructor(message: string, readonly code = 'MEETING_ERROR') {
    super(message)
    this.name = 'MeetingServiceError'
  }
}

export async function listProjectMeetings(projectId: string): Promise<Meeting[]> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, projectId, user.id)

  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new MeetingServiceError('获取会议列表失败')
  }
  return (data ?? []) as Meeting[]
}

export async function getProjectMeeting(
  projectId: string,
  meetingId: string,
): Promise<MeetingWithLatestState | null> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, projectId, user.id)

  const { data, error } = await supabase
    .from('meetings')
    .select(`
      *,
      media_assets (*),
      processing_jobs (${PROCESSING_JOB_PUBLIC_FIELDS})
    `)
    .eq('id', meetingId)
    .eq('project_id', projectId)
    .maybeSingle()

  if (error) {
    throw new MeetingServiceError('获取会议详情失败')
  }
  return data as MeetingWithLatestState | null
}

export async function createMeeting(input: {
  projectId: string
  title: string
  retentionDays: 7 | 30 | 90
}): Promise<string> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, input.projectId, user.id)

  const title = input.title.trim()
  if (!title || title.length > 200) {
    throw new MeetingServiceError('会议标题长度必须为 1 到 200 个字符', 'INVALID_TITLE')
  }

  const { data, error } = await supabase.rpc('create_meeting', {
    p_project_id: input.projectId,
    p_title: title,
    p_retention_days: input.retentionDays,
  })

  if (error || typeof data !== 'string') {
    throw new MeetingServiceError(error?.message ?? '创建会议失败')
  }
  return data
}

export async function initializeAudioUpload(input: {
  projectId: string
  meetingId: string
  originalFilename: string
  mimeType: string
}): Promise<{ mediaAssetId: string; bucket: string; objectPath: string }> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, input.projectId, user.id)

  const { data, error } = await supabase.rpc('initialize_meeting_audio_upload', {
    p_project_id: input.projectId,
    p_meeting_id: input.meetingId,
    p_original_filename: input.originalFilename,
    p_mime_type: input.mimeType,
  })

  const row = Array.isArray(data) ? data[0] : null
  if (error || !row) {
    throw new MeetingServiceError(error?.message ?? '初始化音频上传失败')
  }
  return {
    mediaAssetId: row.media_asset_id,
    bucket: row.bucket,
    objectPath: row.object_path,
  }
}

export async function completeAudioUpload(input: {
  projectId: string
  meetingId: string
  mediaAssetId: string
  sizeBytes: number
  mimeType: string
  sha256: string
}): Promise<string> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, input.projectId, user.id)

  const { data: assetData, error: assetError } = await supabase
    .from('media_assets')
    .select('*')
    .eq('id', input.mediaAssetId)
    .eq('project_id', input.projectId)
    .eq('meeting_id', input.meetingId)
    .eq('kind', 'original')
    .maybeSingle()

  if (assetError || !assetData) {
    throw new MeetingServiceError('媒体不存在或无权限访问')
  }
  const asset = assetData as MediaAsset
  if (asset.status === 'verified') {
    const { data: existingJob, error: jobError } = await supabase
      .from('processing_jobs')
      .select('id')
      .eq('media_asset_id', asset.id)
      .eq('job_type', 'transcription')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (jobError || !existingJob) {
      throw new MeetingServiceError('已验证媒体缺少转写任务')
    }
    return existingJob.id
  }
  if (asset.status !== 'uploading') {
    throw new MeetingServiceError(`当前媒体状态不能完成上传: ${asset.status}`)
  }

  const { data: objectInfo, error: objectError } = await supabase.storage
    .from(asset.bucket)
    .info(asset.object_path)
  if (objectError || !objectInfo) {
    throw new MeetingServiceError('Storage 中未找到完整音频，请等待上传完成后重试')
  }

  const actualSize = objectInfo.size
  const actualMimeType = objectInfo.contentType?.toLowerCase().split(';', 1)[0]
  if (!actualSize || actualSize <= 0 || actualSize > 500_000_000) {
    throw new MeetingServiceError('Storage 音频大小无效')
  }
  if (actualSize !== input.sizeBytes) {
    throw new MeetingServiceError('Storage 音频大小与本地文件不一致，请重新上传')
  }
  if (!actualMimeType || !MEETING_AUDIO_MIME_TYPES.includes(
    actualMimeType as (typeof MEETING_AUDIO_MIME_TYPES)[number],
  )) {
    throw new MeetingServiceError('Storage 音频 MIME 不受支持')
  }
  if (actualMimeType !== input.mimeType || actualMimeType !== asset.mime_type) {
    throw new MeetingServiceError('Storage 音频 MIME 与初始化记录不一致')
  }

  const { data, error } = await supabase.rpc('complete_meeting_audio_upload', {
    p_project_id: input.projectId,
    p_meeting_id: input.meetingId,
    p_media_asset_id: input.mediaAssetId,
    p_size_bytes: actualSize,
    p_mime_type: actualMimeType,
    p_sha256: input.sha256,
  })

  if (error || typeof data !== 'string') {
    throw new MeetingServiceError(error?.message ?? '完成音频上传失败')
  }
  return data
}

export async function getProcessingJob(jobId: string): Promise<ProcessingJob | null> {
  const supabase = await createClient()
  const user = await requireUser(supabase)

  const { data, error } = await supabase
    .from('processing_jobs')
    .select(PROCESSING_JOB_PUBLIC_FIELDS)
    .eq('id', jobId)
    .maybeSingle()

  if (error) {
    throw new MeetingServiceError('获取处理任务失败')
  }
  if (!data) return null
  await requireProjectOwner(supabase, data.project_id, user.id)
  return data as ProcessingJob
}

export async function markProcessingJobDispatchFailed(input: {
  jobId: string
  jobType: 'transcription' | 'meeting_analysis'
  errorMessage: string
}): Promise<'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'> {
  const supabase = await createClient()
  const user = await requireUser(supabase)

  const { data: job, error: jobError } = await supabase
    .from('processing_jobs')
    .select('project_id')
    .eq('id', input.jobId)
    .eq('job_type', input.jobType)
    .maybeSingle()
  if (jobError || !job) throw new MeetingServiceError('处理任务不存在或无权限访问')
  await requireProjectOwner(supabase, job.project_id, user.id)

  const { data, error } = await supabase.rpc('mark_processing_job_dispatch_failed', {
    p_job_id: input.jobId,
    p_expected_job_type: input.jobType,
    p_error_message: input.errorMessage,
  })
  if (error || !['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(String(data))) {
    throw new MeetingServiceError(error?.message ?? '记录后台调度失败状态失败')
  }
  return data as 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
}

export async function retryFailedTranscriptionJob(jobId: string): Promise<string> {
  const supabase = await createClient()
  await requireUser(supabase)

  const { data, error } = await supabase.rpc('retry_failed_transcription_job', {
    p_job_id: jobId,
  })
  if (error || typeof data !== 'string') {
    throw new MeetingServiceError(error?.message ?? '重新提交转写任务失败')
  }
  return data
}

export async function retryFailedMeetingAnalysisJob(jobId: string): Promise<string> {
  const supabase = await createClient()
  await requireUser(supabase)

  const { data, error } = await supabase.rpc('retry_failed_meeting_analysis_job', {
    p_job_id: jobId,
  })
  if (error || typeof data !== 'string') {
    const code = error?.code === '40001' ? 'ANALYSIS_CONFLICT' : 'MEETING_ERROR'
    throw new MeetingServiceError(error?.message ?? '重新提交会议提炼任务失败', code)
  }
  return data
}

export async function getTranscriptReview(
  projectId: string,
  meetingId: string,
): Promise<TranscriptReviewData | null> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, projectId, user.id)

  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('id')
    .eq('id', meetingId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (meetingError || !meeting) return null

  const { data: revision, error: revisionError } = await supabase
    .from('transcript_revisions')
    .select(TRANSCRIPT_REVISION_PUBLIC_FIELDS)
    .eq('meeting_id', meetingId)
    .or('and(kind.eq.human,status.in.(draft,in_review,approved)),and(kind.eq.machine,status.eq.in_review)')
    .order('revision_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (revisionError) {
    throw new MeetingServiceError('获取转写版本失败')
  }
  if (!revision) return null

  const { data: segments, error: segmentsError } = await supabase
    .from('transcript_segments')
    .select(TRANSCRIPT_SEGMENT_PUBLIC_FIELDS)
    .eq('transcript_revision_id', revision.id)
    .order('sequence_no')
  if (segmentsError) {
    throw new MeetingServiceError('获取转写片段失败')
  }

  return {
    revision: revision as TranscriptReviewData['revision'],
    segments: (segments ?? []) as TranscriptSegment[],
  }
}

export async function createOrResumeTranscriptDraft(input: {
  projectId: string
  meetingId: string
}): Promise<TranscriptReviewData> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, input.projectId, user.id)

  const { data: revisionId, error } = await supabase.rpc(
    'create_or_resume_human_transcript_draft',
    { p_meeting_id: input.meetingId },
  )
  if (error || typeof revisionId !== 'string') {
    throw new MeetingServiceError(error?.message ?? '创建校对草稿失败')
  }

  const { data: revision, error: revisionError } = await supabase
    .from('transcript_revisions')
    .select(TRANSCRIPT_REVISION_PUBLIC_FIELDS)
    .eq('id', revisionId)
    .eq('project_id', input.projectId)
    .eq('meeting_id', input.meetingId)
    .single()
  const { data: segments, error: segmentsError } = await supabase
    .from('transcript_segments')
    .select(TRANSCRIPT_SEGMENT_PUBLIC_FIELDS)
    .eq('transcript_revision_id', revisionId)
    .order('sequence_no')
  if (revisionError || segmentsError || !revision) {
    throw new MeetingServiceError('读取校对草稿失败')
  }
  return {
    revision: revision as TranscriptReviewData['revision'],
    segments: (segments ?? []) as TranscriptSegment[],
  }
}

export function normalizedTranscriptText(segments: Array<Pick<EditableTranscriptSegment, 'text'>>): string {
  return segments.map((segment) => segment.text.trim()).join('\n')
}

export function transcriptReviewContentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export async function saveTranscriptDraft(input: {
  projectId: string
  meetingId: string
  revisionId: string
  expectedUpdatedAt: string
  segments: EditableTranscriptSegment[]
}): Promise<string> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, input.projectId, user.id)

  const fullText = normalizedTranscriptText(input.segments)
  const contentHash = transcriptReviewContentHash(fullText)
  const { data, error } = await supabase.rpc('save_human_transcript_draft', {
    p_meeting_id: input.meetingId,
    p_revision_id: input.revisionId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_full_text: fullText,
    p_content_hash: contentHash,
    p_segments: input.segments,
  })
  if (error || typeof data !== 'string') {
    const code = error?.code === '40001' ? 'TRANSCRIPT_CONFLICT' : 'MEETING_ERROR'
    throw new MeetingServiceError(error?.message ?? '保存校对草稿失败', code)
  }
  return data
}

export async function approveTranscriptDraft(input: {
  projectId: string
  meetingId: string
  revisionId: string
  expectedUpdatedAt: string
}): Promise<void> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, input.projectId, user.id)

  const { error } = await supabase.rpc('approve_transcript_revision', {
    p_meeting_id: input.meetingId,
    p_revision_id: input.revisionId,
    p_expected_updated_at: input.expectedUpdatedAt,
  })
  if (error) {
    const code = error.code === '40001' ? 'TRANSCRIPT_CONFLICT' : 'MEETING_ERROR'
    throw new MeetingServiceError(error.message, code)
  }
}

export async function startMeetingAnalysis(input: {
  projectId: string
  meetingId: string
}): Promise<string> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, input.projectId, user.id)

  const modelId = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  const { data, error } = await supabase.rpc('start_meeting_analysis', {
    p_project_id: input.projectId,
    p_meeting_id: input.meetingId,
    p_model_id: modelId,
    p_prompt_version: MEETING_ANALYSIS_PROMPT_VERSION,
    p_schema_version: MEETING_ANALYSIS_SCHEMA_VERSION,
    p_config_version: MEETING_ANALYSIS_CONFIG_VERSION,
  })
  if (error || typeof data !== 'string') {
    throw new MeetingServiceError(error?.message ?? '启动会议分析失败')
  }
  return data
}

export async function getLatestMeetingAnalysis(
  projectId: string,
  meetingId: string,
): Promise<MeetingAnalysisVersion | null> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, projectId, user.id)

  const { data, error } = await supabase
    .from('meeting_analysis_versions')
    .select('id,project_id,meeting_id,transcript_revision_id,revision_no,parent_version_id,status,summary,model_id,prompt_version,schema_version,config_version,created_at,updated_at,reviewed_at')
    .eq('project_id', projectId)
    .eq('meeting_id', meetingId)
    .order('revision_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new MeetingServiceError('获取会议分析版本失败')
  return data as MeetingAnalysisVersion | null
}

export async function getLatestMeetingRequirementChangeSet(
  projectId: string,
  meetingId: string,
  analysisVersionId: string,
): Promise<Pick<RequirementChangeSetReviewData['changeSet'], 'id' | 'status' | 'updated_at'> | null> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, projectId, user.id)

  const { data, error } = await supabase
    .from('requirement_change_sets')
    .select('id,status,updated_at')
    .eq('project_id', projectId)
    .eq('meeting_id', meetingId)
    .eq('analysis_version_id', analysisVersionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new MeetingServiceError('获取会议需求更新状态失败')
  return data as Pick<RequirementChangeSetReviewData['changeSet'], 'id' | 'status' | 'updated_at'> | null
}

export async function getMeetingAnalysisReview(
  projectId: string,
  meetingId: string,
  analysisVersionId?: string,
): Promise<MeetingAnalysisReviewData | null> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, projectId, user.id)

  let versionQuery = supabase
    .from('meeting_analysis_versions')
    .select('id,project_id,meeting_id,transcript_revision_id,revision_no,parent_version_id,status,summary,model_id,prompt_version,schema_version,config_version,created_at,updated_at,reviewed_at')
    .eq('project_id', projectId)
    .eq('meeting_id', meetingId)
  versionQuery = analysisVersionId
    ? versionQuery.eq('id', analysisVersionId)
    : versionQuery.order('revision_no', { ascending: false }).limit(1)
  const { data: version, error: versionError } = await versionQuery.maybeSingle()
  if (versionError) throw new MeetingServiceError('获取会议分析版本失败')
  if (!version) return null

  const { data: items, error: itemsError } = await supabase
    .from('meeting_analysis_items')
    .select(`
      id,project_id,meeting_id,analysis_version_id,sequence_no,category,title,description,review_status,created_at,updated_at,
      evidence:meeting_analysis_evidence(
        transcript_segment_id,sequence_no,
        segment:transcript_segments(
          id,project_id,meeting_id,transcript_revision_id,sequence_no,speaker_key,start_ms,end_ms,text,confidence,words,source_segment_id,created_at,updated_at
        )
      )
    `)
    .eq('analysis_version_id', version.id)
    .order('sequence_no')
  if (itemsError) throw new MeetingServiceError('获取会议洞察项失败')

  const normalizedItems = (items ?? []).map((item) => ({
    ...item,
    evidence: [...(item.evidence ?? [])]
      .sort((a, b) => a.sequence_no - b.sequence_no)
      .map((evidence) => {
        const segment = Array.isArray(evidence.segment) ? evidence.segment[0] : evidence.segment
        if (!segment) {
          throw new MeetingServiceError('会议洞察证据来源不完整')
        }
        return { ...evidence, segment }
      }),
  }))
  return {
    version: version as MeetingAnalysisReviewData['version'],
    items: normalizedItems as unknown as MeetingAnalysisReviewData['items'],
  }
}

export interface SavedMeetingAnalysisItem {
  itemId: string
  reviewStatus: 'pending' | 'accepted' | 'excluded'
  itemUpdatedAt: string
  versionUpdatedAt: string
}

export async function saveMeetingAnalysisItem(input: {
  projectId: string
  meetingId: string
  analysisVersionId: string
  itemId: string
  expectedUpdatedAt: string
  title: string
  description: string
  reviewStatus: 'pending' | 'accepted' | 'excluded'
}): Promise<SavedMeetingAnalysisItem> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, input.projectId, user.id)

  const { data: versionUpdatedAt, error } = await supabase.rpc('save_meeting_analysis_item', {
    p_project_id: input.projectId,
    p_meeting_id: input.meetingId,
    p_analysis_version_id: input.analysisVersionId,
    p_item_id: input.itemId,
    p_expected_version_updated_at: input.expectedUpdatedAt,
    p_title: input.title,
    p_description: input.description,
    p_review_status: input.reviewStatus,
  })
  if (error || typeof versionUpdatedAt !== 'string') {
    const code = error?.code === '40001' ? 'ANALYSIS_CONFLICT' : 'MEETING_ERROR'
    throw new MeetingServiceError(error?.message ?? '保存会议洞察审核结果失败', code)
  }

  const { data: savedItem, error: savedItemError } = await supabase
    .from('meeting_analysis_items')
    .select('id,review_status,updated_at')
    .eq('id', input.itemId)
    .eq('analysis_version_id', input.analysisVersionId)
    .eq('project_id', input.projectId)
    .eq('meeting_id', input.meetingId)
    .maybeSingle()
  if (
    savedItemError
    || !savedItem
    || !['pending', 'accepted', 'excluded'].includes(savedItem.review_status)
  ) {
    throw new MeetingServiceError('会议洞察已保存，但无法读取最新状态')
  }

  return {
    itemId: savedItem.id,
    reviewStatus: savedItem.review_status as SavedMeetingAnalysisItem['reviewStatus'],
    itemUpdatedAt: savedItem.updated_at,
    versionUpdatedAt,
  }
}

export async function approveMeetingAnalysisVersion(input: {
  projectId: string
  meetingId: string
  analysisVersionId: string
  expectedUpdatedAt: string
}): Promise<void> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, input.projectId, user.id)

  const { error } = await supabase.rpc('approve_meeting_analysis_version', {
    p_project_id: input.projectId,
    p_meeting_id: input.meetingId,
    p_analysis_version_id: input.analysisVersionId,
    p_expected_updated_at: input.expectedUpdatedAt,
  })
  if (error) {
    const code = error.code === '40001' ? 'ANALYSIS_CONFLICT' : 'MEETING_ERROR'
    throw new MeetingServiceError(error.message, code)
  }
}

export async function createOrResumeRequirementChangeSet(input: {
  projectId: string
  meetingId: string
  analysisVersionId: string
}): Promise<string> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, input.projectId, user.id)

  const { data, error } = await supabase.rpc('create_or_resume_requirement_change_set', {
    p_project_id: input.projectId,
    p_meeting_id: input.meetingId,
    p_analysis_version_id: input.analysisVersionId,
  })
  if (error || typeof data !== 'string') {
    throw new MeetingServiceError(error?.message ?? '创建需求变更集失败')
  }
  return data
}

export async function getRequirementChangeSetReview(
  projectId: string,
  changeSetId: string,
): Promise<RequirementChangeSetReviewData | null> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, projectId, user.id)

  const { data: changeSet, error: changeSetError } = await supabase
    .from('requirement_change_sets')
    .select('id,project_id,meeting_id,analysis_version_id,transcript_revision_id,base_baseline_id,base_requirement_id,base_canonical_content,base_content_hash,base_snapshot,base_project_description_snapshot,status,superseded_by_change_set_id,resulting_baseline_id,created_at,updated_at,applied_at,superseded_at')
    .eq('id', changeSetId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (changeSetError) throw new MeetingServiceError('获取需求变更集失败')
  if (!changeSet) return null

  const { data: items, error: itemsError } = await supabase
    .from('requirement_change_items')
    .select('id,project_id,change_set_id,source_analysis_version_id,source_analysis_item_id,target_entry_id,sequence_no,category,operation,target_path,source_title,source_content,title,content,mapping_status,disposition,mapping_reason,review_status,created_at,updated_at')
    .eq('change_set_id', changeSet.id)
    .order('sequence_no')
  if (itemsError) throw new MeetingServiceError('获取需求变更项失败')

  return {
    changeSet: changeSet as RequirementChangeSetReviewData['changeSet'],
    items: (items ?? []) as RequirementChangeSetReviewData['items'],
  }
}

export async function saveRequirementChangeItem(input: {
  projectId: string
  changeSetId: string
  itemId: string
  expectedUpdatedAt: string
  operation: RequirementChangeOperation
  targetPath: RequirementChangeTarget
  targetEntryId: string | null
  title: string
  content: string
  disposition: RequirementChangeDisposition
}): Promise<string> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, input.projectId, user.id)

  const { data, error } = await supabase.rpc('save_requirement_change_item', {
    p_project_id: input.projectId,
    p_change_set_id: input.changeSetId,
    p_item_id: input.itemId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_operation: input.operation,
    p_target_path: input.targetPath,
    p_target_entry_id: input.targetEntryId,
    p_title: input.title,
    p_content: input.content,
    p_disposition: input.disposition,
  })
  if (error || typeof data !== 'string') {
    const code = error?.code === '40001' ? 'REQUIREMENT_CHANGE_CONFLICT' : 'MEETING_ERROR'
    throw new MeetingServiceError(error?.message ?? '保存需求变更项失败', code)
  }
  return data
}

export async function applyRequirementChangeSet(input: {
  projectId: string
  changeSetId: string
  expectedUpdatedAt: string
}): Promise<string> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, input.projectId, user.id)

  const { data, error } = await supabase.rpc('apply_requirement_change_set', {
    p_project_id: input.projectId,
    p_change_set_id: input.changeSetId,
    p_expected_updated_at: input.expectedUpdatedAt,
  })
  if (error || typeof data !== 'string') {
    const code = error?.code === '40001' ? 'REQUIREMENT_CHANGE_CONFLICT' : 'MEETING_ERROR'
    throw new MeetingServiceError(error?.message ?? '应用需求变更集失败', code)
  }
  return data
}

export async function getCurrentRequirementBaseline(
  projectId: string,
): Promise<RequirementBaseline | null> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, projectId, user.id)

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('current_requirement_baseline_id')
    .eq('id', projectId)
    .maybeSingle()
  if (projectError) throw new MeetingServiceError('获取项目需求基线指针失败')
  if (!project?.current_requirement_baseline_id) return null

  const { data, error } = await supabase
    .from('requirement_baselines')
    .select('id,project_id,revision_no,parent_baseline_id,source_requirement_id,source_meeting_id,source_transcript_revision_id,source_analysis_version_id,applied_change_set_id,canonical_content,content_hash,snapshot,project_description_snapshot,created_at')
    .eq('id', project.current_requirement_baseline_id)
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) throw new MeetingServiceError('获取当前需求基线失败')
  return data as RequirementBaseline | null
}

export async function createMeetingAudioPlaybackUrl(input: {
  projectId: string
  meetingId: string
  mediaAssetId: string
}): Promise<{ signedUrl: string; expiresIn: number }> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, input.projectId, user.id)

  const { data: asset, error: assetError } = await supabase
    .from('media_assets')
    .select('id,bucket,object_path,status')
    .eq('id', input.mediaAssetId)
    .eq('project_id', input.projectId)
    .eq('meeting_id', input.meetingId)
    .eq('kind', 'original')
    .maybeSingle()
  if (assetError || !asset || !['verified', 'ready'].includes(asset.status)) {
    throw new MeetingServiceError('会议音频不存在或尚未准备完成')
  }

  const expiresIn = 600
  const { data, error } = await supabase.storage
    .from(asset.bucket)
    .createSignedUrl(asset.object_path, expiresIn)
  if (error || !data?.signedUrl) {
    throw new MeetingServiceError('生成音频播放地址失败')
  }
  return { signedUrl: data.signedUrl, expiresIn }
}

export function isRequirementChangeConflict(error: unknown): boolean {
  return error instanceof MeetingServiceError && error.code === 'REQUIREMENT_CHANGE_CONFLICT'
}

export function isMeetingAnalysisConflict(error: unknown): boolean {
  return error instanceof MeetingServiceError && error.code === 'ANALYSIS_CONFLICT'
}

export function isMeetingServiceConflict(error: unknown): boolean {
  return error instanceof MeetingServiceError && error.code === 'TRANSCRIPT_CONFLICT'
}

export function meetingErrorMessage(error: unknown): string {
  if (error instanceof MeetingPermissionError || error instanceof MeetingServiceError) {
    return error.message
  }
  return '会议操作失败，请重试'
}
