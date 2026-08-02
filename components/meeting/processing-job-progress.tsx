'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import type { ProcessingJob } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

const statusLabels: Record<ProcessingJob['status'], string> = {
  queued: '排队中',
  running: '处理中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const stageLabels: Record<string, string> = {
  queued: '等待系统处理',
  claiming: '正在准备任务',
  preprocessing: '正在准备音频',
  normalizing: '正在优化音频',
  uploading: '正在提交音频',
  transcribing: '正在生成会议记录',
  polling: '正在等待会议记录',
  parsing: '正在整理会议记录',
  analyzing: '正在提炼需求信息',
  extracting: '正在提炼需求信息',
  persisting: '正在保存提炼结果',
  completed: '处理完成',
  failed: '处理未完成',
}

const terminalStatuses = new Set<ProcessingJob['status']>(['succeeded', 'failed', 'cancelled'])

export function ProcessingJobProgress({ initialJob }: { initialJob: ProcessingJob }) {
  const router = useRouter()
  const [job, setJob] = useState(initialJob)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => setJob(initialJob), [initialJob])

  useEffect(() => {
    if (terminalStatuses.has(job.status)) return

    let stopped = false
    const timer = window.setInterval(() => {
      void fetch(`/api/processing-jobs/${job.id}`, { cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) throw new Error('任务状态查询失败')
          return response.json() as Promise<ProcessingJob>
        })
        .then((nextJob) => {
          if (stopped || nextJob.event_sequence < job.event_sequence) return
          setJob(nextJob)
          if (terminalStatuses.has(nextJob.status)) router.refresh()
        })
        .catch(() => undefined)
    }, 5_000)

    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [job.event_sequence, job.id, job.status, router])

  async function retryJob() {
    setRetrying(true)
    try {
      const response = await fetch(`/api/processing-jobs/${job.id}/retry`, { method: 'POST' })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const message = body && typeof body === 'object' && 'error' in body
          && typeof body.error === 'string' ? body.error : '重新提交任务失败'
        throw new Error(message)
      }
      toast.success(job.job_type === 'transcription' ? '会议记录任务已重新提交' : '需求提炼任务已重新提交')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重新提交任务失败')
    } finally {
      setRetrying(false)
    }
  }

  const canRetry = ['transcription', 'meeting_analysis'].includes(job.job_type)
    && job.status === 'failed'
  const retryLabel = job.job_type === 'transcription' ? '重新生成会议记录' : '重新提炼需求'
  const dispatchFailed = job.error_code === 'TASK_DISPATCH_FAILED'

  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{stageLabels[job.stage] ?? '正在处理会议内容'}</span>
        <Badge variant="secondary">{statusLabels[job.status]}</Badge>
      </div>
      <Progress value={job.progress_percent} aria-label={`处理进度 ${job.progress_percent}%`} />
      <p className="text-right text-xs text-muted-foreground">{job.progress_percent}%</p>
      {job.error_message ? <p className="text-sm text-destructive">{job.error_message}</p> : null}
      {canRetry ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-3">
          <p className="text-xs text-muted-foreground">
            {dispatchFailed
              ? '后台任务尚未开始，原始输入和失败记录均已保留，可以安全地重新提交。'
              : '已保留原始输入与失败记录，无需重新上传或重复校对。'}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={retrying}
            onClick={() => void retryJob()}
          >
            {retrying ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            {retrying ? '提交中…' : retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
