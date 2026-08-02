import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { notFound } from 'next/navigation'
import { getMeetingAnalysisReview, getProjectMeeting } from '@/lib/meetings/service'
import { MeetingInsightReview } from '@/components/meeting/meeting-insight-review'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default async function MeetingInsightsPage({
  params,
}: {
  params: Promise<{ id: string; meetingId: string }>
}) {
  const { id, meetingId } = await params
  const [meeting, review] = await Promise.all([
    getProjectMeeting(id, meetingId),
    getMeetingAnalysisReview(id, meetingId),
  ])
  if (!meeting) notFound()

  const originalAudio = meeting.media_assets.find((asset) =>
    asset.kind === 'original' && ['verified', 'ready'].includes(asset.status),
  )
  if (!review) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link href={`/projects/${id}/meetings/${meetingId}`}>
            <ArrowLeft />返回会议详情
          </Link>
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>会议提炼结果尚未就绪</CardTitle>
            <CardDescription>请先确认会议记录，并等待系统完成需求信息提炼。</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={`/projects/${id}/meetings/${meetingId}`}>查看处理状态</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button variant="ghost" asChild>
          <Link href={`/projects/${id}/meetings/${meetingId}`}>
            <ArrowLeft />返回会议详情
          </Link>
        </Button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{meeting.title} · 确认会议提炼结果</h2>
          <p className="text-muted-foreground">
            核对系统从已确认会议记录中提炼的需求、决策与风险，并可随时查看原文证据。
          </p>
        </div>
      </div>
      <MeetingInsightReview
        projectId={id}
        meetingId={meetingId}
        audioAsset={originalAudio ? {
          id: originalAudio.id,
          mime_type: originalAudio.mime_type,
        } : undefined}
        initialReview={review}
      />
    </div>
  )
}
