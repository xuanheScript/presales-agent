import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createOrResumeTranscriptDraft,
  meetingErrorMessage,
} from '@/lib/meetings/service'

const requestSchema = z.object({
  projectId: z.uuid(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  const { meetingId } = await params
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!z.uuid().safeParse(meetingId).success || !parsed.success) {
    return NextResponse.json({ error: '校对草稿参数无效' }, { status: 400 })
  }

  try {
    const draft = await createOrResumeTranscriptDraft({
      projectId: parsed.data.projectId,
      meetingId,
    })
    return NextResponse.json(draft, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return NextResponse.json({ error: meetingErrorMessage(error) }, { status: 400 })
  }
}
