import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createOrResumeRequirementChangeSet,
  meetingErrorMessage,
} from '@/lib/meetings/service'

const requestSchema = z.strictObject({
  projectId: z.uuid(),
  analysisVersionId: z.uuid(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  const { meetingId } = await params
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!z.uuid().safeParse(meetingId).success || !parsed.success) {
    return NextResponse.json({ error: '创建需求变更集参数无效' }, { status: 400 })
  }

  try {
    const changeSetId = await createOrResumeRequirementChangeSet({
      ...parsed.data,
      meetingId,
    })
    return NextResponse.json({ changeSetId }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return NextResponse.json({ error: meetingErrorMessage(error) }, { status: 400 })
  }
}
