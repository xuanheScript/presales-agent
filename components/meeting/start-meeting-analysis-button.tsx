'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BrainCircuit, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

async function responseJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body
      && typeof body.error === 'string' ? body.error : '启动会议分析失败'
    throw new Error(message)
  }
  return body as T
}

export function StartMeetingAnalysisButton({
  projectId,
  meetingId,
}: {
  projectId: string
  meetingId: string
}) {
  const router = useRouter()
  const [starting, setStarting] = useState(false)

  async function startAnalysis() {
    setStarting(true)
    try {
      const response = await fetch(`/api/meetings/${meetingId}/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      await responseJson<{ processingJobId: string }>(response)
      toast.success('需求提炼任务已启动')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '启动会议分析失败')
    } finally {
      setStarting(false)
    }
  }

  return (
    <Button onClick={() => void startAnalysis()} disabled={starting}>
      {starting ? <Loader2 className="animate-spin" /> : <BrainCircuit />}
      重新提炼需求
    </Button>
  )
}
