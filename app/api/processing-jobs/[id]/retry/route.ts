import { NextResponse } from 'next/server'
import { tasks } from '@trigger.dev/sdk'
import { z } from 'zod'
import type { analyzeMeetingTask } from '@/trigger/analyze-meeting'
import type { transcribeMeetingTask } from '@/trigger/transcribe-meeting'
import {
  meetingTaskDispatchFailureMessage,
  recoverMeetingTaskDispatchFailure,
} from '@/lib/meetings/task-dispatch-recovery'
import {
  getProcessingJob,
  meetingErrorMessage,
  retryFailedMeetingAnalysisJob,
  retryFailedTranscriptionJob,
} from '@/lib/meetings/service'

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: '任务 ID 无效' }, { status: 400 })
  }

  const failedJob = await getProcessingJob(id).catch(() => null)
  if (!failedJob || !['transcription', 'meeting_analysis'].includes(failedJob.job_type)) {
    return NextResponse.json({ error: '该任务不支持人工重试' }, { status: 400 })
  }

  let processingJobId: string
  try {
    processingJobId = failedJob.job_type === 'transcription'
      ? await retryFailedTranscriptionJob(id)
      : await retryFailedMeetingAnalysisJob(id)
  } catch (error) {
    console.error('Failed to create processing retry job', {
      jobId: id,
      jobType: failedJob.job_type,
      error,
    })
    return NextResponse.json({ error: meetingErrorMessage(error) }, { status: 400 })
  }

  try {
    if (failedJob.job_type === 'transcription') {
      const handle = await tasks.trigger<typeof transcribeMeetingTask>(
        'transcribe-meeting',
        { processingJobId },
        {
          idempotencyKey: `transcribe-meeting:${processingJobId}`,
          idempotencyKeyTTL: '30d',
        },
      )
      return NextResponse.json({ processingJobId, backgroundRunId: handle.id })
    }

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
    console.error('Failed to dispatch processing retry job', {
      failedJobId: id,
      processingJobId,
      jobType: failedJob.job_type,
      error,
    })
    const dispatchJobType = failedJob.job_type as 'transcription' | 'meeting_analysis'
    const dispatchStatus = await recoverMeetingTaskDispatchFailure({
      processingJobId,
      jobType: dispatchJobType,
      error,
    })
    return NextResponse.json({
      error: meetingTaskDispatchFailureMessage(dispatchJobType, dispatchStatus),
      processingJobId,
      dispatchStatus,
    }, { status: 503 })
  }
}
