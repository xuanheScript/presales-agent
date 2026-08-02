import { createClient } from '@/lib/supabase/server'
import { requireProjectOwner, requireUser } from '@/lib/meetings/permissions'
import type {
  MeetingStatus,
  ProcessingJobStatus,
  Requirement,
  RequirementBaseline,
  RequirementChangeSetStatus,
} from '@/types'

export type RequirementSourceKind = 'text' | 'document' | 'meeting' | 'elicitation'
export type RequirementSourceStatus =
  | 'draft'
  | 'processing'
  | 'review_required'
  | 'pending_changes'
  | 'included'
  | 'failed'

export interface RequirementWorkbenchSource {
  id: string
  kind: RequirementSourceKind
  title: string
  description: string
  status: RequirementSourceStatus
  statusLabel: string
  updatedAt: string
  href: string
  pendingCount: number
  canApply: boolean
}

export interface RequirementWorkbenchData {
  currentBaseline: RequirementBaseline | null
  latestRequirement: Requirement | null
  editableRequirement: Requirement | null
  sources: RequirementWorkbenchSource[]
  pendingCount: number
  estimateFreshness: 'missing' | 'current' | 'stale'
  latestEstimateRevision: number | null
  activeElicitationSessionId: string | null
  completedElicitationCount: number
}

interface MeetingRow {
  id: string
  title: string
  status: MeetingStatus
  approved_transcript_revision_id: string | null
  latest_analysis_version_id: string | null
  created_at: string
  updated_at: string
}

interface JobRow {
  id: string
  meeting_id: string
  job_type: 'transcription' | 'meeting_analysis'
  status: ProcessingJobStatus
  created_at: string
}

interface AnalysisRow {
  id: string
  meeting_id: string
  transcript_revision_id: string
  status: 'in_review' | 'approved' | 'superseded'
  revision_no: number
  updated_at: string
}

interface ChangeSetRow {
  id: string
  meeting_id: string
  analysis_version_id: string
  status: RequirementChangeSetStatus
  updated_at: string
}

interface AnalysisItemRow {
  analysis_version_id: string
  review_status: 'pending' | 'accepted' | 'excluded'
}

interface ChangeItemRow {
  change_set_id: string
  mapping_status: 'auto_mapped' | 'decision_required' | 'ready'
}

const jobIsActive = (job: JobRow | undefined) =>
  job?.status === 'queued' || job?.status === 'running'

function latestByMeeting<T extends { meeting_id: string; created_at?: string; revision_no?: number }>(
  rows: T[],
): Map<string, T> {
  const result = new Map<string, T>()
  for (const row of rows) {
    const current = result.get(row.meeting_id)
    if (!current) {
      result.set(row.meeting_id, row)
      continue
    }
    if (row.revision_no !== undefined && current.revision_no !== undefined) {
      if (row.revision_no > current.revision_no) result.set(row.meeting_id, row)
      continue
    }
    if ((row.created_at ?? '') > (current.created_at ?? '')) result.set(row.meeting_id, row)
  }
  return result
}

function meetingSource(input: {
  projectId: string
  meeting: MeetingRow
  latestJob?: JobRow
  latestAnalysis?: AnalysisRow
  changeSet?: ChangeSetRow
  pendingInsightCount: number
  pendingProjectionCount: number
}): RequirementWorkbenchSource {
  const { projectId, meeting, latestJob, latestAnalysis, changeSet } = input
  const baseHref = `/projects/${projectId}/meetings/${meeting.id}`
  const analysisMatchesTranscript = Boolean(
    latestAnalysis
      && meeting.approved_transcript_revision_id
      && latestAnalysis.transcript_revision_id === meeting.approved_transcript_revision_id,
  )

  if (latestJob?.status === 'failed') {
    return {
      id: meeting.id,
      kind: 'meeting',
      title: meeting.title,
      description: '自动处理未完成，可从会议详情重新提交。',
      status: 'failed',
      statusLabel: '处理失败',
      updatedAt: latestJob.created_at,
      href: baseHref,
      pendingCount: 0,
      canApply: false,
    }
  }

  if (jobIsActive(latestJob) || ['uploading', 'transcribing', 'analyzing'].includes(meeting.status)) {
    return {
      id: meeting.id,
      kind: 'meeting',
      title: meeting.title,
      description: '系统正在生成会议记录或提炼需求信息。',
      status: 'processing',
      statusLabel: '自动处理中',
      updatedAt: meeting.updated_at,
      href: baseHref,
      pendingCount: 0,
      canApply: false,
    }
  }

  if (!meeting.approved_transcript_revision_id) {
    return {
      id: meeting.id,
      kind: 'meeting',
      title: meeting.title,
      description: meeting.status === 'draft' ? '尚未添加会议音频。' : '会议记录已生成，等待人工确认。',
      status: meeting.status === 'draft' ? 'draft' : 'review_required',
      statusLabel: meeting.status === 'draft' ? '待添加音频' : '待确认会议记录',
      updatedAt: meeting.updated_at,
      href: baseHref,
      pendingCount: 0,
      canApply: false,
    }
  }

  if (!latestAnalysis || !analysisMatchesTranscript) {
    return {
      id: meeting.id,
      kind: 'meeting',
      title: meeting.title,
      description: latestAnalysis
        ? '会议记录已更新，需要基于最新版本重新提炼需求。'
        : '会议记录已确认，等待提炼需求信息。',
      status: 'review_required',
      statusLabel: latestAnalysis ? '需要重新提炼' : '待提炼需求',
      updatedAt: meeting.updated_at,
      href: baseHref,
      pendingCount: 0,
      canApply: false,
    }
  }

  if (changeSet?.status === 'applied') {
    return {
      id: meeting.id,
      kind: 'meeting',
      title: meeting.title,
      description: '本次会议确认的需求信息已纳入正式需求。',
      status: 'included',
      statusLabel: '已纳入需求',
      updatedAt: changeSet.updated_at,
      href: baseHref,
      pendingCount: 0,
      canApply: false,
    }
  }

  const pendingCount = changeSet?.status === 'in_review'
    ? input.pendingProjectionCount
    : input.pendingInsightCount
  const href = changeSet?.status === 'in_review'
    ? `${baseHref}/requirement-changes/${changeSet.id}`
    : `${baseHref}/insights`

  return {
    id: meeting.id,
    kind: 'meeting',
    title: meeting.title,
    description: changeSet?.status === 'in_review'
      ? '会议事实已确认，请决定如何更新项目需求。'
      : '请核对系统从会议记录中提炼出的需求、决策和风险。',
    status: 'pending_changes',
    statusLabel: '待确认需求影响',
    updatedAt: changeSet?.updated_at ?? latestAnalysis.updated_at,
    href,
    pendingCount,
    canApply: false,
  }
}

export async function getRequirementWorkbench(projectId: string): Promise<RequirementWorkbenchData> {
  const supabase = await createClient()
  const user = await requireUser(supabase)
  await requireProjectOwner(supabase, projectId, user.id)

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('current_requirement_baseline_id,latest_estimate_version_id')
    .eq('id', projectId)
    .maybeSingle()
  if (projectError || !project) throw new Error('获取需求工作台失败')

  const [requirementsResult, meetingsResult, analysesResult, changeSetsResult, analysisItemsResult, changeItemsResult, elicitationResult] = await Promise.all([
    supabase
      .from('requirements')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false }),
    supabase
      .from('meetings')
      .select('id,title,status,approved_transcript_revision_id,latest_analysis_version_id,created_at,updated_at')
      .eq('project_id', projectId)
      .neq('status', 'archived')
      .order('created_at', { ascending: false }),
    supabase
      .from('meeting_analysis_versions')
      .select('id,meeting_id,transcript_revision_id,status,revision_no,updated_at')
      .eq('project_id', projectId)
      .order('revision_no', { ascending: false }),
    supabase
      .from('requirement_change_sets')
      .select('id,meeting_id,analysis_version_id,status,updated_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false }),
    supabase
      .from('meeting_analysis_items')
      .select('analysis_version_id,review_status')
      .eq('project_id', projectId),
    supabase
      .from('requirement_change_items')
      .select('change_set_id,mapping_status')
      .eq('project_id', projectId),
    supabase
      .from('elicitation_sessions')
      .select('id,status,created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false }),
  ])

  if (
    requirementsResult.error
    || meetingsResult.error
    || analysesResult.error
    || changeSetsResult.error
    || analysisItemsResult.error
    || changeItemsResult.error
    || elicitationResult.error
  ) {
    throw new Error('读取需求来源失败')
  }

  const requirements = (requirementsResult.data ?? []) as Requirement[]
  const meetings = (meetingsResult.data ?? []) as MeetingRow[]
  const analyses = (analysesResult.data ?? []) as AnalysisRow[]
  const changeSets = (changeSetsResult.data ?? []) as ChangeSetRow[]
  const analysisItems = (analysisItemsResult.data ?? []) as AnalysisItemRow[]
  const changeItems = (changeItemsResult.data ?? []) as ChangeItemRow[]
  const elicitationSessions = (elicitationResult.data ?? []) as Array<{
    id: string
    status: 'active' | 'completed' | 'cancelled'
    created_at: string
  }>

  const [baselineResult, estimateResult, jobsResult] = await Promise.all([
    project.current_requirement_baseline_id
      ? supabase
          .from('requirement_baselines')
          .select('id,project_id,revision_no,parent_baseline_id,source_requirement_id,source_meeting_id,source_transcript_revision_id,source_analysis_version_id,applied_change_set_id,canonical_content,content_hash,snapshot,project_description_snapshot,created_at')
          .eq('id', project.current_requirement_baseline_id)
          .eq('project_id', projectId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    project.latest_estimate_version_id
      ? supabase
          .from('estimate_versions')
          .select('requirement_baseline_id,revision_no')
          .eq('id', project.latest_estimate_version_id)
          .eq('project_id', projectId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    meetings.length > 0
      ? supabase
          .from('processing_jobs')
          .select('id,meeting_id,job_type,status,created_at')
          .eq('project_id', projectId)
          .in('meeting_id', meetings.map((meeting) => meeting.id))
          .in('job_type', ['transcription', 'meeting_analysis'])
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ])

  if (baselineResult.error || estimateResult.error || jobsResult.error) {
    throw new Error('读取需求工作台版本状态失败')
  }

  const baseline = baselineResult.data as RequirementBaseline | null
  const estimate = estimateResult.data as { requirement_baseline_id: string; revision_no: number } | null
  const latestAnalyses = latestByMeeting(analyses)
  const latestJobs = latestByMeeting((jobsResult.data ?? []) as JobRow[])
  const changeSetByAnalysis = new Map(changeSets.map((changeSet) => [changeSet.analysis_version_id, changeSet]))
  const pendingInsightsByAnalysis = new Map<string, number>()
  for (const item of analysisItems) {
    if (item.review_status !== 'pending') continue
    pendingInsightsByAnalysis.set(
      item.analysis_version_id,
      (pendingInsightsByAnalysis.get(item.analysis_version_id) ?? 0) + 1,
    )
  }
  const pendingProjectionBySet = new Map<string, number>()
  for (const item of changeItems) {
    if (item.mapping_status !== 'decision_required') continue
    pendingProjectionBySet.set(
      item.change_set_id,
      (pendingProjectionBySet.get(item.change_set_id) ?? 0) + 1,
    )
  }

  const includedRequirementEntries = new Map<string, string>()
  if (baseline) {
    for (const entries of Object.values(baseline.snapshot.sections)) {
      for (const entry of entries) {
        if (entry.sourceRequirementId) {
          includedRequirementEntries.set(entry.sourceRequirementId, entry.content.trim())
        }
      }
    }
  }

  const requirementSources: RequirementWorkbenchSource[] = requirements.map((requirement) => {
    const baselineSource = baseline?.snapshot.sourceRequirement
    const entryContent = includedRequirementEntries.get(requirement.id)
    const isIncluded = (
      baselineSource?.id === requirement.id
      && baselineSource.rawContent.trim() === requirement.raw_content.trim()
    ) || entryContent === requirement.raw_content.trim()
    const kind: RequirementSourceKind = requirement.source === 'elicitation'
      ? 'elicitation'
      : requirement.requirement_type === 'document'
        ? 'document'
        : 'text'
    return {
      id: requirement.id,
      kind,
      title: kind === 'document'
        ? '需求文档'
        : kind === 'elicitation'
          ? 'AI 需求澄清'
          : '需求文本',
      description: requirement.raw_content.trim().slice(0, 100),
      status: isIncluded ? 'included' : 'draft',
      statusLabel: isIncluded ? '已纳入需求' : baseline ? '待确认' : '草稿待确认',
      updatedAt: requirement.created_at,
      href: '#requirement-sources',
      pendingCount: isIncluded ? 0 : 1,
      canApply: !isIncluded,
    }
  })

  const meetingSources = meetings.map((meeting) => {
    const latestAnalysis = latestAnalyses.get(meeting.id)
    const changeSet = latestAnalysis ? changeSetByAnalysis.get(latestAnalysis.id) : undefined
    return meetingSource({
      projectId,
      meeting,
      latestJob: latestJobs.get(meeting.id),
      latestAnalysis,
      changeSet,
      pendingInsightCount: latestAnalysis ? pendingInsightsByAnalysis.get(latestAnalysis.id) ?? 0 : 0,
      pendingProjectionCount: changeSet ? pendingProjectionBySet.get(changeSet.id) ?? 0 : 0,
    })
  })

  const sources = [...requirementSources, ...meetingSources]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const pendingCount = sources.reduce((sum, source) => {
    if (source.status === 'draft' || source.status === 'review_required') return sum + 1
    if (source.status === 'pending_changes') return sum + Math.max(source.pendingCount, 1)
    return sum
  }, 0)

  return {
    currentBaseline: baseline,
    latestRequirement: requirements[0] ?? null,
    editableRequirement: requirements.find((requirement) =>
      requirement.source !== 'elicitation'
      && !includedRequirementEntries.has(requirement.id)
      && baseline?.snapshot.sourceRequirement?.id !== requirement.id,
    ) ?? null,
    sources,
    pendingCount,
    estimateFreshness: !estimate
      ? 'missing'
      : baseline && estimate.requirement_baseline_id === baseline.id
        ? 'current'
        : 'stale',
    latestEstimateRevision: estimate?.revision_no ?? null,
    activeElicitationSessionId: elicitationSessions.find((session) => session.status === 'active')?.id ?? null,
    completedElicitationCount: elicitationSessions.filter((session) => session.status === 'completed').length,
  }
}
