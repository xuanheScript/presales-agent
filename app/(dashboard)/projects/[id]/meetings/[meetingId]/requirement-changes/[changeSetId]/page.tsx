import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { notFound } from 'next/navigation'
import { getRequirementChangeSetReview } from '@/lib/meetings/service'
import { RequirementChangeSetReview } from '@/components/meeting/requirement-change-set-review'
import { Button } from '@/components/ui/button'

export default async function RequirementChangeSetPage({
  params,
}: {
  params: Promise<{ id: string; meetingId: string; changeSetId: string }>
}) {
  const { id, meetingId, changeSetId } = await params
  const review = await getRequirementChangeSetReview(id, changeSetId)
  if (!review || review.changeSet.meeting_id !== meetingId) notFound()

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button type="button" variant="ghost" asChild>
          <Link href={`/projects/${id}/meetings/${meetingId}/insights`}>
            <ArrowLeft />返回会议提炼结果
          </Link>
        </Button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">更新项目需求</h2>
          <p className="text-muted-foreground">
            确认本次会议对项目需求的影响。已确认的会议事实不会被修改，更新后会生成新的正式需求版本。
          </p>
        </div>
      </div>
      <RequirementChangeSetReview projectId={id} initialReview={review} />
    </div>
  )
}
