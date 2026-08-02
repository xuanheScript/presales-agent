'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  CheckCircle,
  Circle,
  Loader2,
  RefreshCw,
  Sparkles,
  Square,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  AGENT_RUN_POLL_INTERVAL_MS,
  queuedRunError,
} from '@/lib/agents/run-status'
import { cn } from '@/lib/utils'

const WORKFLOW_STEPS = [
  { key: 'analyze', label: '需求理解', description: '读取正式需求，识别目标、约束与范围' },
  { key: 'breakdown', label: '方案拆解', description: '拆分功能模块并匹配历史参考' },
  { key: 'estimate', label: '工时评估', description: '估算角色投入、工期和额外工作' },
  { key: 'calculate', label: '成本计算', description: '按确定性规则汇总成本并生成版本' },
] as const

type WorkflowStepKey = (typeof WORKFLOW_STEPS)[number]['key']
type RunState = 'idle' | 'running' | 'success' | 'error' | 'cancelled'

interface AgentProgressProps {
  projectId: string
  requirementBaselineId: string
}

export function AgentProgress({ projectId, requirementBaselineId }: AgentProgressProps) {
  const router = useRouter()
  const [runState, setRunState] = useState<RunState>('idle')
  const [currentStep, setCurrentStep] = useState<WorkflowStepKey | null>(null)
  const [completedSteps, setCompletedSteps] = useState<WorkflowStepKey[]>([])
  const [error, setError] = useState<string | null>(null)
  const [backgroundRunId, setBackgroundRunId] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortControllerRef.current?.abort(), [projectId, requirementBaselineId])

  const progress = (completedSteps.length / WORKFLOW_STEPS.length) * 100

  const cancelWorkflow = useCallback(async () => {
    if (!backgroundRunId) return

    try {
      const response = await fetch(
        `/api/agent/runs/${encodeURIComponent(backgroundRunId)}?projectId=${encodeURIComponent(projectId)}`,
        { method: 'DELETE' },
      )
      const body = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error || '取消后台分析失败')

      abortControllerRef.current?.abort()
      setBackgroundRunId(null)
      setRunState('cancelled')
      setCurrentStep(null)
      toast.info('分析任务已取消')
    } catch (cancelError) {
      console.error('取消后台分析失败:', cancelError)
      toast.error(cancelError instanceof Error ? cancelError.message : '取消后台分析失败')
    }
  }, [backgroundRunId, projectId])

  async function runWorkflow() {
    if (runState === 'running') return

    setRunState('running')
    setError(null)
    setCompletedSteps([])
    setCurrentStep('analyze')

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const response = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          requirementBaselineId,
          requestId: crypto.randomUUID(),
        }),
        signal: controller.signal,
      })
      const startData = await response.json() as { backgroundRunId?: string; error?: string }
      if (!response.ok || !startData.backgroundRunId) {
        throw new Error(startData.error || '启动方案分析失败')
      }

      const runId = startData.backgroundRunId
      setBackgroundRunId(runId)
      const pollingStartedAt = Date.now()
      let finished = false

      while (!finished) {
        await new Promise((resolve) => setTimeout(resolve, AGENT_RUN_POLL_INTERVAL_MS))
        controller.signal.throwIfAborted()

        const statusResponse = await fetch(
          `/api/agent/runs/${encodeURIComponent(runId)}?projectId=${encodeURIComponent(projectId)}`,
          { signal: controller.signal },
        )
        const statusData = await statusResponse.json() as {
          status?: string
          isTerminal?: boolean
          estimateVersionId?: string | null
          error?: string
        }
        if (!statusResponse.ok) throw new Error(statusData.error || '查询方案分析状态失败')

        const queueError = queuedRunError(statusData.status, Date.now() - pollingStartedAt)
        if (queueError) {
          await fetch(
            `/api/agent/runs/${encodeURIComponent(runId)}?projectId=${encodeURIComponent(projectId)}`,
            { method: 'DELETE', signal: controller.signal },
          ).catch(() => undefined)
          throw new Error(queueError)
        }

        if (statusData.status === 'DEQUEUED') {
          setCompletedSteps(['analyze'])
          setCurrentStep('breakdown')
        } else if (statusData.status === 'EXECUTING') {
          setCompletedSteps(['analyze', 'breakdown'])
          setCurrentStep('estimate')
        } else if (statusData.status === 'WAITING') {
          setCompletedSteps(['analyze', 'breakdown', 'estimate'])
          setCurrentStep('calculate')
        }

        if (!statusData.isTerminal) continue
        finished = true
        if (statusData.status !== 'COMPLETED' || !statusData.estimateVersionId) {
          throw new Error(statusData.error || '方案分析未成功完成')
        }
      }

      setCompletedSteps(WORKFLOW_STEPS.map((step) => step.key))
      setCurrentStep(null)
      setRunState('success')
      toast.success('方案与成本分析完成', {
        description: '已生成新的不可变估算版本，请继续审核后发布。',
      })
      router.refresh()
    } catch (runError) {
      if (controller.signal.aborted || (runError instanceof Error && runError.name === 'AbortError')) {
        return
      }
      console.error('方案分析失败:', runError)
      setRunState('error')
      setError(runError instanceof Error ? runError.message : '执行失败')
      setCurrentStep(null)
      toast.error('方案分析失败', {
        description: runError instanceof Error ? runError.message : '请重试',
      })
    } finally {
      setBackgroundRunId(null)
      if (abortControllerRef.current === controller) abortControllerRef.current = null
    }
  }

  function stepIcon(stepKey: WorkflowStepKey) {
    if (completedSteps.includes(stepKey)) return <CheckCircle className="h-5 w-5 text-emerald-600" />
    if (currentStep === stepKey) return <Loader2 className="h-5 w-5 animate-spin text-primary" />
    return <Circle className="h-5 w-5 text-muted-foreground/30" />
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              生成方案与成本版本
            </CardTitle>
            <CardDescription className="mt-1">
              本次分析绑定当前正式需求，完成后生成一份可追溯、可审核的不可变版本。
            </CardDescription>
          </div>
          {runState === 'running' ? <Badge variant="secondary">分析中</Badge> : null}
          {runState === 'success' ? <Badge>已完成</Badge> : null}
          {runState === 'error' ? <Badge variant="destructive">失败</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {runState === 'running' ? (
          <div className="space-y-2">
            <Progress value={progress} className="h-2" />
            <p className="text-center text-xs text-muted-foreground">
              系统正在后台处理，关闭页面不会中止任务。
            </p>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {WORKFLOW_STEPS.map((step, index) => (
            <div
              key={step.key}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-4 transition-colors',
                currentStep === step.key && 'border-primary/40 bg-primary/5',
                runState === 'idle' && 'text-muted-foreground',
              )}
            >
              {stepIcon(step.key)}
              <div>
                <p className="text-xs tabular-nums text-muted-foreground">0{index + 1}</p>
                <p className="font-medium text-foreground">{step.label}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        {runState === 'error' && error ? (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}
          </div>
        ) : null}

        {runState === 'cancelled' ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />分析已取消，可以重新开始。
          </div>
        ) : null}

        {runState === 'success' ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            新估算版本已生成，可在右侧查看版本详情并继续审核。
          </div>
        ) : null}

        {runState === 'running' ? (
          <Button variant="destructive" className="w-full" onClick={() => void cancelWorkflow()} disabled={!backgroundRunId}>
            <Square className="h-4 w-4" />停止分析
          </Button>
        ) : (
          <Button className="w-full" onClick={() => void runWorkflow()}>
            {runState === 'idle' ? <Sparkles className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
            {runState === 'idle' ? '开始方案与成本分析' : '基于当前需求重新分析'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
