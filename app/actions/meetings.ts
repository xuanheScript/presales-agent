'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  createMeeting,
  meetingErrorMessage,
} from '@/lib/meetings/service'
import type { ActionResult } from '@/app/actions/projects'

export async function createMeetingAction(
  projectId: string,
  _previousState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const rawRetentionDays = Number(formData.get('retentionDays') ?? 30)
  if (![7, 30, 90].includes(rawRetentionDays)) {
    return { error: '音频保留期只支持 7、30 或 90 天' }
  }

  let meetingId: string
  try {
    meetingId = await createMeeting({
      projectId,
      title: String(formData.get('title') ?? ''),
      retentionDays: rawRetentionDays as 7 | 30 | 90,
    })
  } catch (error) {
    return { error: meetingErrorMessage(error) }
  }

  revalidatePath(`/projects/${projectId}/meetings`)
  redirect(`/projects/${projectId}/meetings/${meetingId}`)
}
