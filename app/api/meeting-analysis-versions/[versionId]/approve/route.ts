import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  approveMeetingAnalysisVersion,
  isMeetingAnalysisConflict,
  meetingErrorMessage,
} from '@/lib/meetings/service'

const requestSchema = z.strictObject({
  projectId: z.uuid(),
  meetingId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const { versionId } = await params
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!z.uuid().safeParse(versionId).success || !parsed.success) {
    return NextResponse.json({ error: '会议分析批准参数无效' }, { status: 400 })
  }

  try {
    await approveMeetingAnalysisVersion({
      ...parsed.data,
      analysisVersionId: versionId,
    })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return NextResponse.json(
      { error: meetingErrorMessage(error) },
      { status: isMeetingAnalysisConflict(error) ? 409 : 400 },
    )
  }
}
