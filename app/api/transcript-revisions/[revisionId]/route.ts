import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  isMeetingServiceConflict,
  meetingErrorMessage,
  saveTranscriptDraft,
} from '@/lib/meetings/service'

const wordSchema = z.object({
  text: z.string(),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
  confidence: z.number().min(0).max(1).optional(),
})

const segmentSchema = z.object({
  sequenceNo: z.number().int().nonnegative(),
  speakerKey: z.string().trim().max(100).nullable(),
  startMs: z.number().int().min(0).max(7_200_000),
  endMs: z.number().int().min(0).max(7_200_000),
  text: z.string().trim().min(1).max(20_000),
  confidence: z.number().min(0).max(1).nullable(),
  words: z.array(wordSchema).max(20_000),
  sourceSegmentId: z.uuid().nullable(),
}).refine((segment) => segment.endMs >= segment.startMs, {
  message: '片段结束时间不能早于开始时间',
})

const requestSchema = z.object({
  projectId: z.uuid(),
  meetingId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  segments: z.array(segmentSchema).min(1).max(10_000),
})

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ revisionId: string }> },
) {
  const { revisionId } = await params
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!z.uuid().safeParse(revisionId).success || !parsed.success) {
    return NextResponse.json({ error: '校对稿保存参数无效' }, { status: 400 })
  }

  try {
    const updatedAt = await saveTranscriptDraft({
      ...parsed.data,
      revisionId,
    })
    return NextResponse.json({ updatedAt }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return NextResponse.json(
      { error: meetingErrorMessage(error) },
      { status: isMeetingServiceConflict(error) ? 409 : 400 },
    )
  }
}
