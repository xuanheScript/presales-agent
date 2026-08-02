import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getProcessingJob,
  meetingErrorMessage,
} from '@/lib/meetings/service'

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: '任务 ID 无效' }, { status: 400 })
  }

  try {
    const job = await getProcessingJob(id)
    if (!job) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }
    return NextResponse.json(job)
  } catch (error) {
    return NextResponse.json({ error: meetingErrorMessage(error) }, { status: 403 })
  }
}
