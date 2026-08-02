import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  isRequirementChangeConflict,
  meetingErrorMessage,
  saveRequirementChangeItem,
} from '@/lib/meetings/service'

const targetPaths = [
  'requirements',
  'business_goals',
  'key_features',
  'tech_stack',
  'non_functional_requirements',
  'risks',
  'decisions',
  'action_items',
  'conflicts',
  'open_questions',
  'out_of_scope',
] as const

const requestSchema = z.strictObject({
  projectId: z.uuid(),
  changeSetId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  operation: z.enum(['add', 'replace', 'remove', 'note']),
  targetPath: z.enum(targetPaths),
  targetEntryId: z.string().trim().min(1).max(200).nullable(),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(4_000),
  disposition: z.enum(['include', 'omit']),
})

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await params
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!z.uuid().safeParse(itemId).success || !parsed.success) {
    return NextResponse.json({ error: '需求变更项保存参数无效' }, { status: 400 })
  }

  try {
    const updatedAt = await saveRequirementChangeItem({ ...parsed.data, itemId })
    return NextResponse.json({ updatedAt }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return NextResponse.json(
      { error: meetingErrorMessage(error) },
      { status: isRequirementChangeConflict(error) ? 409 : 400 },
    )
  }
}
