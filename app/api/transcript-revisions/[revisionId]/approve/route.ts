import { NextResponse } from 'next/server'
import { tasks } from '@trigger.dev/sdk'
import { z } from 'zod'
import type { analyzeMeetingTask } from '@/trigger/analyze-meeting'
import {
  approveTranscriptDraft,
  isMeetingServiceConflict,
  meetingErrorMessage,
  startMeetingAnalysis,
} from '@/lib/meetings/service'
import {
  meetingTaskDispatchFailureMessage,
  recoverMeetingTaskDispatchFailure,
} from '@/lib/meetings/task-dispatch-recovery'

const requestSchema = z.object({
  projectId: z.uuid(),
  meetingId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ revisionId: string }> },
) {
  const { revisionId } = await params
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!z.uuid().safeParse(revisionId).success || !parsed.success) {
    return NextResponse.json({ error: '确认会议记录参数无效' }, { status: 400 })
  }

  try {
    await approveTranscriptDraft({ ...parsed.data, revisionId })
  } catch (error) {
    return NextResponse.json(
      { error: meetingErrorMessage(error) },
      { status: isMeetingServiceConflict(error) ? 409 : 400 },
    )
  }

  let processingJobId: string
  try {
    processingJobId = await startMeetingAnalysis({
      projectId: parsed.data.projectId,
      meetingId: parsed.data.meetingId,
    })
  } catch (error) {
    console.error('Transcript approved but meeting analysis job creation failed', {
      revisionId,
      meetingId: parsed.data.meetingId,
      error,
    })
    return NextResponse.json({
      transcriptApproved: true,
      analysisStarted: false,
      error: `会议记录已确认，但自动提炼未启动：${meetingErrorMessage(error)}`,
    }, { status: 202 })
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
    return NextResponse.json({
      transcriptApproved: true,
      analysisStarted: true,
      processingJobId,
      backgroundRunId: handle.id,
    })
  } catch (error) {
    console.error('Transcript approved but meeting analysis dispatch failed', {
      revisionId,
      meetingId: parsed.data.meetingId,
      processingJobId,
      error,
    })
    const dispatchStatus = await recoverMeetingTaskDispatchFailure({
      processingJobId,
      jobType: 'meeting_analysis',
      error,
    })
    return NextResponse.json({
      transcriptApproved: true,
      analysisStarted: dispatchStatus === 'running' || dispatchStatus === 'succeeded',
      processingJobId,
      dispatchStatus,
      error: meetingTaskDispatchFailureMessage('meeting_analysis', dispatchStatus),
    }, { status: 202 })
  }
}
