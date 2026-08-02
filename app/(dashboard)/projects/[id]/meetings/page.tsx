import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CalendarDays, ChevronRight, Mic, Plus } from 'lucide-react'
import { getProject } from '@/app/actions/projects'
import { CreateMeetingForm } from '@/components/meeting/create-meeting-form'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { listProjectMeetings } from '@/lib/meetings/service'
import type { MeetingStatus } from '@/types'

const statusLabels: Record<MeetingStatus, string> = {
  draft: '待上传',
  uploading: '上传中',
  transcribing: '转写中',
  review_required: '待校对',
  analyzing: '分析中',
  estimate_ready: '估算就绪',
  published: '已发布',
  archived: '已归档',
}

export default async function MeetingsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const project = await getProject(id)
  if (!project) notFound()

  const meetings = await listProjectMeetings(id)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">会议录音</h2>
        <p className="text-muted-foreground">
          创建需求会议，上传录音并在人工校对后生成会议分析和功能估算。
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {meetings.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex min-h-64 flex-col items-center justify-center text-center">
                <div className="mb-4 rounded-full bg-muted p-4">
                  <Mic className="h-7 w-7 text-muted-foreground" />
                </div>
                <h3 className="font-semibold">还没有会议</h3>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  创建第一场会议后，可以上传最长 2 小时、最大 500 MB 的音频。
                </p>
              </CardContent>
            </Card>
          ) : (
            meetings.map((meeting) => (
              <Link key={meeting.id} href={`/projects/${id}/meetings/${meeting.id}`}>
                <Card className="transition-colors hover:bg-muted/40">
                  <CardContent className="flex items-center justify-between py-5">
                    <div className="min-w-0 space-y-2">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-semibold">{meeting.title}</h3>
                        <Badge variant="secondary">{statusLabels[meeting.status]}</Badge>
                      </div>
                      <p className="flex items-center gap-1 text-sm text-muted-foreground">
                        <CalendarDays className="h-4 w-4" />
                        {new Date(meeting.created_at).toLocaleString('zh-CN')}
                        <span>· 音频保留 {meeting.retention_days} 天</span>
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))
          )}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="h-4 w-4" />
              新建会议
            </CardTitle>
            <CardDescription>先创建会议，再进入详情页上传已有录音。</CardDescription>
          </CardHeader>
          <CardContent>
            <CreateMeetingForm projectId={id} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
