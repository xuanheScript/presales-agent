import { NextResponse } from 'next/server'
import { tasks } from '@trigger.dev/sdk'
import { z } from 'zod'
import type { analyzeMeetingTask } from '@/trigger/analyze-meeting'
import {
  meetingErrorMessage,
  startMeetingAnalysis,
} from '@/lib/meetings/service'
import {
  meetingTaskDispatchFailureMessage,
  recoverMeetingTaskDispatchFailure,
} from '@/lib/meetings/task-dispatch-recovery'

const requestSchema = z.strictObject({
  projectId: z.uuid(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  const { meetingId } = await params
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!z.uuid().safeParse(meetingId).success || !parsed.success) {
    return NextResponse.json({ error: '会议提炼参数无效' }, { status: 400 })
  }

  let processingJobId: string
  try {
    processingJobId = await startMeetingAnalysis({
      projectId: parsed.data.projectId,
      meetingId,
    })
  } catch (error) {
    return NextResponse.json({ error: meetingErrorMessage(error) }, { status: 400 })
  }

  try {
    const handle = await tasks.trigger<typeof analyzeMeetingTask>(
      'analyze-meeting',
      { processingJobId },
      {
        idempotencyKey: `analyze-meeting:${processingJobId}`,
        idempotencyKeyTTL: '30d',
      },
    )
    return NextResponse.json({ processingJobId, backgroundRunId: handle.id })
  } catch (error) {
    console.error('Failed to dispatch meeting analysis job', {
      meetingId,
      processingJobId,
      error,
    })
    const dispatchStatus = await recoverMeetingTaskDispatchFailure({
      processingJobId,
      jobType: 'meeting_analysis',
      error,
    })
    return NextResponse.json({
      error: meetingTaskDispatchFailureMessage('meeting_analysis', dispatchStatus),
      processingJobId,
      dispatchStatus,
    }, { status: 503 })
  }
}
