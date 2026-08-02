import { NextResponse } from 'next/server'
import { z } from 'zod'
import { tasks } from '@trigger.dev/sdk'
import type { transcribeMeetingTask } from '@/trigger/transcribe-meeting'
import {
  completeAudioUpload,
  meetingErrorMessage,
} from '@/lib/meetings/service'
import {
  meetingTaskDispatchFailureMessage,
  recoverMeetingTaskDispatchFailure,
} from '@/lib/meetings/task-dispatch-recovery'

const requestSchema = z.object({
  projectId: z.uuid(),
  meetingId: z.uuid(),
  sizeBytes: z.number().int().positive().max(500_000_000),
  mimeType: z.string().trim().min(1).max(100),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: '媒体 ID 无效' }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: '上传完成参数无效' }, { status: 400 })
  }

  let processingJobId: string
  try {
    processingJobId = await completeAudioUpload({
      mediaAssetId: id,
      ...parsed.data,
    })
  } catch (error) {
    return NextResponse.json({ error: meetingErrorMessage(error) }, { status: 400 })
  }

  try {
    const handle = await tasks.trigger<typeof transcribeMeetingTask>(
      'transcribe-meeting',
      { processingJobId },
      {
        idempotencyKey: `transcribe-meeting:${processingJobId}`,
        idempotencyKeyTTL: '30d',
      },
    )
    return NextResponse.json({ processingJobId, backgroundRunId: handle.id })
  } catch (error) {
    console.error('Audio uploaded but transcription dispatch failed', {
      mediaAssetId: id,
      processingJobId,
      error,
    })
    const dispatchStatus = await recoverMeetingTaskDispatchFailure({
      processingJobId,
      jobType: 'transcription',
      error,
    })
    return NextResponse.json({
      audioUploaded: true,
      processingJobId,
      dispatchStatus,
      error: meetingTaskDispatchFailureMessage('transcription', dispatchStatus),
    }, { status: 202 })
  }
}
