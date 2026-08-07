import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  isMeetingAnalysisConflict,
  meetingErrorMessage,
  saveMeetingAnalysisItem,
} from '@/lib/meetings/service'

const requestSchema = z.strictObject({
  projectId: z.uuid(),
  meetingId: z.uuid(),
  analysisVersionId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(4_000),
  reviewStatus: z.enum(['pending', 'accepted', 'excluded']),
})

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await params
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!z.uuid().safeParse(itemId).success || !parsed.success) {
    return NextResponse.json({ error: '会议洞察保存参数无效' }, { status: 400 })
  }

  try {
    const savedItem = await saveMeetingAnalysisItem({ ...parsed.data, itemId })
    return NextResponse.json({
      itemId: savedItem.itemId,
      reviewStatus: savedItem.reviewStatus,
      updatedAt: savedItem.versionUpdatedAt,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return NextResponse.json(
      { error: meetingErrorMessage(error) },
      { status: isMeetingAnalysisConflict(error) ? 409 : 400 },
    )
  }
}
