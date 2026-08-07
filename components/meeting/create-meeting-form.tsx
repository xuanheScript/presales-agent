'use client'

import { useActionState } from 'react'
import { createMeetingAction } from '@/app/actions/meetings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActionResult } from '@/app/actions/projects'

const initialState: ActionResult = {}

export function CreateMeetingForm({ projectId }: { projectId: string }) {
  const action = createMeetingAction.bind(null, projectId)
  const [state, formAction, pending] = useActionState(action, initialState)

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="meeting-title">会议标题</Label>
        <Input
          id="meeting-title"
          name="title"
          maxLength={200}
          placeholder="例如：客户需求澄清会"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="retention-days">原始音频保留期</Label>
        <select
          id="retention-days"
          name="retentionDays"
          defaultValue="30"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="7">7 天</option>
          <option value="30">30 天（推荐）</option>
          <option value="90">90 天</option>
        </select>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? '创建中…' : '创建会议'}
      </Button>
    </form>
  )
}
