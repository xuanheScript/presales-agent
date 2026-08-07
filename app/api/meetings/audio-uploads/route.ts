import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  initializeAudioUpload,
  meetingErrorMessage,
} from '@/lib/meetings/service'

const requestSchema = z.object({
  projectId: z.uuid(),
  meetingId: z.uuid(),
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(100),
})

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: '上传初始化参数无效' }, { status: 400 })
  }

  try {
    const upload = await initializeAudioUpload(parsed.data)
    return NextResponse.json(upload, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: meetingErrorMessage(error) }, { status: 400 })
  }
}
