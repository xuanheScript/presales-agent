import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  applyRequirementChangeSet,
  isRequirementChangeConflict,
  meetingErrorMessage,
} from '@/lib/meetings/service'

const requestSchema = z.strictObject({
  projectId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ changeSetId: string }> },
) {
  const { changeSetId } = await params
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!z.uuid().safeParse(changeSetId).success || !parsed.success) {
    return NextResponse.json({ error: '应用需求变更集参数无效' }, { status: 400 })
  }

  try {
    const baselineId = await applyRequirementChangeSet({
      ...parsed.data,
      changeSetId,
    })
    return NextResponse.json({ baselineId }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return NextResponse.json(
      { error: meetingErrorMessage(error) },
      { status: isRequirementChangeConflict(error) ? 409 : 400 },
    )
  }
}
