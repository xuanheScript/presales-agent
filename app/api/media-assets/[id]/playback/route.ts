import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createMeetingAudioPlaybackUrl,
  meetingErrorMessage,
} from '@/lib/meetings/service'

const querySchema = z.object({
  projectId: z.uuid(),
  meetingId: z.uuid(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const url = new URL(request.url)
  const parsed = querySchema.safeParse({
    projectId: url.searchParams.get('projectId'),
    meetingId: url.searchParams.get('meetingId'),
  })
  if (!z.uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: '音频播放参数无效' }, { status: 400 })
  }

  try {
    const playback = await createMeetingAudioPlaybackUrl({
      mediaAssetId: id,
      ...parsed.data,
    })
    return NextResponse.json(playback, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (error) {
    return NextResponse.json(
      { error: meetingErrorMessage(error) },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
