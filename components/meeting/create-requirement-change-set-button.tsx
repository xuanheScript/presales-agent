'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileDiff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

async function responseJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body
      && typeof body.error === 'string' ? body.error : '创建需求变更集失败'
    throw new Error(message)
  }
  return body as T
}

export function CreateRequirementChangeSetButton({
  projectId,
  meetingId,
  analysisVersionId,
}: {
  projectId: string
  meetingId: string
  analysisVersionId: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function createChangeSet() {
    setPending(true)
    try {
      const response = await fetch(`/api/meetings/${meetingId}/requirement-change-set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, analysisVersionId }),
      })
      const data = await responseJson<{ changeSetId: string }>(response)
      router.push(`/projects/${projectId}/meetings/${meetingId}/requirement-changes/${data.changeSetId}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建需求变更集失败')
      setPending(false)
    }
  }

  return (
    <Button disabled={pending} onClick={() => void createChangeSet()}>
      {pending ? <Loader2 className="animate-spin" /> : <FileDiff />}
      继续更新项目需求
    </Button>
  )
}
