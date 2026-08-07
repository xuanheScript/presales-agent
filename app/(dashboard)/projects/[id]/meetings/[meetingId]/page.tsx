import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BrainCircuit, Check, ChevronRight, FileAudio, ShieldCheck } from 'lucide-react'
import {
  getLatestMeetingAnalysis,
  getLatestMeetingRequirementChangeSet,
  getProjectMeeting,
  getTranscriptReview,
} from '@/lib/meetings/service'
import { ProcessingJobProgress } from '@/components/meeting/processing-job-progress'
import { ResumableMeetingAudioUploader } from '@/components/meeting/resumable-uploader'
import { StartMeetingAnalysisButton } from '@/components/meeting/start-meeting-analysis-button'
import { TranscriptReviewEditor } from '@/components/meeting/transcript-review-editor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { MeetingStatus } from '@/types'

const statusLabels: Record<MeetingStatus, string> = {
  draft: '待添加音频',
  uploading: '上传中',
  transcribing: '生成会议记录中',
  review_required: '待确认',
  analyzing: '提炼需求中',
  estimate_ready: '待进入方案分析',
  published: '已纳入需求',
  archived: '已归档',
}

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string; meetingId: string }>
}) {
  const { id, meetingId } = await params
  const meeting = await getProjectMeeting(id, meetingId)
  if (!meeting) notFound()

  const [transcriptReview, queriedAnalysis] = await Promise.all([
    meeting.status === 'review_required' || meeting.approved_transcript_revision_id
      ? getTranscriptReview(id, meetingId)
      : Promise.resolve(null),
    meeting.latest_analysis_version_id
      ? getLatestMeetingAnalysis(id, meetingId)
      : Promise.resolve(null),
  ])

  const originalAudio = meeting.media_assets.find((asset) => asset.kind === 'original')
  const jobsByNewest = [...meeting.processing_jobs].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const analysisJob = jobsByNewest.find((job) => job.job_type === 'meeting_analysis')
  const latestJob = jobsByNewest.find((job) => job.status === 'running' || job.status === 'queued') ?? jobsByNewest[0]
  const approvedTranscript = meeting.approved_transcript_revision_id !== null
  const latestAnalysis = queriedAnalysis?.transcript_revision_id === meeting.approved_transcript_revision_id
    ? queriedAnalysis
    : null
  const latestChangeSet = latestAnalysis
    ? await getLatestMeetingRequirementChangeSet(id, meetingId, latestAnalysis.id)
    : null
  const analysisIsStale = Boolean(queriedAnalysis && !latestAnalysis)
  const analysisInProgress = Boolean(
    analysisJob && (analysisJob.status === 'queued' || analysisJob.status === 'running'),
  )
  const audioReady = Boolean(originalAudio && ['verified', 'ready'].includes(originalAudio.status))
  const transcriptConfirmed = Boolean(approvedTranscript)
  const impactReady = latestChangeSet?.status === 'applied'
  const impactHref = latestChangeSet?.status === 'in_review'
    ? `/projects/${id}/meetings/${meetingId}/requirement-changes/${latestChangeSet.id}`
    : latestChangeSet?.status === 'applied'
      ? `/projects/${id}`
      : `/projects/${id}/meetings/${meetingId}/insights`

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Meeting source</p>
          <h2 className="text-2xl font-bold tracking-tight">{meeting.title}</h2>
          <p className="mt-1 text-muted-foreground">
            会议作为需求来源保留原始证据；普通流程只需确认会议记录与需求影响。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/projects/${id}`}>返回需求工作台</Link>
          </Button>
          <Badge>{statusLabels[meeting.status]}</Badge>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-4 py-5 md:grid-cols-3">
          {[
            ['01', '添加会议音频', audioReady],
            ['02', '确认会议记录', transcriptConfirmed],
            ['03', '确认需求影响', impactReady],
          ].map(([index, label, complete]) => (
            <div key={String(index)} className="flex items-center gap-3">
              <span className={complete
                ? 'flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white'
                : 'flex h-9 w-9 items-center justify-center rounded-full border text-xs text-muted-foreground'}>
                {complete ? <Check className="h-4 w-4" /> : index}
              </span>
              <span className={complete ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><FileAudio className="h-4 w-4" />会议音频</CardTitle>
            <CardDescription>支持 WAV、FLAC、MP3、OGG、WebM 和 MP4，最大 500 MB、最长 2 小时。</CardDescription>
          </CardHeader>
          <CardContent>
            {audioReady && originalAudio ? (
              <div className="space-y-2 rounded-md border p-4 text-sm">
                <p className="font-medium">{originalAudio.original_filename}</p>
                <p className="text-muted-foreground">
                  音频已就绪{originalAudio.size_bytes ? ` · ${(originalAudio.size_bytes / 1024 / 1024).toFixed(1)} MB` : ''}
                </p>
              </div>
            ) : (
              <ResumableMeetingAudioUploader
                projectId={id}
                meetingId={meetingId}
                existingTarget={originalAudio ? {
                  mediaAssetId: originalAudio.id,
                  bucket: originalAudio.bucket,
                  objectPath: originalAudio.object_path,
                  originalFilename: originalAudio.original_filename,
                  mimeType: originalAudio.mime_type,
                } : undefined}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" />自动处理</CardTitle>
            <CardDescription>系统会依次生成会议记录和需求提炼结果，失败时可从此处恢复。</CardDescription>
          </CardHeader>
          <CardContent>
            {latestJob ? (
              <ProcessingJobProgress initialJob={latestJob} />
            ) : (
              <p className="text-sm text-muted-foreground">添加并确认音频后，系统会自动生成会议记录。</p>
            )}
          </CardContent>
        </Card>
      </div>

      {transcriptReview && originalAudio && audioReady ? (
        <TranscriptReviewEditor
          projectId={id}
          meetingId={meetingId}
          audioAsset={{ id: originalAudio.id, mime_type: originalAudio.mime_type }}
          initialReview={transcriptReview}
        />
      ) : null}

      {approvedTranscript ? (
        <Card className={analysisIsStale ? 'border-amber-300' : undefined}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><BrainCircuit className="h-4 w-4" />确认需求影响</CardTitle>
            <CardDescription>
              系统只从已确认会议记录提炼需求、决策、风险和未决问题，并保留原文证据。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1 text-sm">
              {latestAnalysis ? (
                <>
                  <p className="font-medium">
                    提炼版本 V{latestAnalysis.revision_no} · {latestChangeSet?.status === 'applied'
                      ? '需求影响已确认'
                      : latestChangeSet?.status === 'in_review'
                        ? '待更新项目需求'
                        : latestAnalysis.status === 'approved'
                          ? '会议事实已确认'
                          : '待确认会议事实'}
                  </p>
                  <p className="text-muted-foreground">{latestAnalysis.summary}</p>
                </>
              ) : analysisInProgress ? (
                <p className="text-muted-foreground">系统正在基于已确认会议记录提炼需求影响。</p>
              ) : analysisIsStale ? (
                <p className="text-amber-800">会议记录已更新，旧提炼结果已保留但不再作为当前结果。</p>
              ) : (
                <p className="text-muted-foreground">会议记录已确认，等待提炼需求信息。</p>
              )}
            </div>
            {latestAnalysis ? (
              <Button asChild>
                <Link href={impactHref}>
                  {latestChangeSet?.status === 'applied'
                    ? '查看正式需求'
                    : latestChangeSet?.status === 'in_review'
                      ? '继续确认需求影响'
                      : latestAnalysis.status === 'approved'
                        ? '继续更新项目需求'
                        : '确认需求影响'}
                  <ChevronRight />
                </Link>
              </Button>
            ) : analysisInProgress ? (
              <Badge variant="secondary">提炼中</Badge>
            ) : (
              <StartMeetingAnalysisButton projectId={id} meetingId={meetingId} />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
