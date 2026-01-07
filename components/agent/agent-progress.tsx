'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import {
  CheckCircle,
  Circle,
  Loader2,
  AlertCircle,
  Sparkles,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'

// 工作流步骤信息（从服务端复制，避免导入服务端模块）
const WORKFLOW_STEPS = [
  {
    key: 'analyze',
    label: '需求分析',
    description: '提取项目类型、业务目标、核心功能',
  },
  {
    key: 'breakdown',
    label: '功能拆解',
    description: '拆分功能模块、查询功能库',
  },
  {
    key: 'estimate',
    label: '工时评估',
    description: '计算开发工时、人员配置',
  },
  {
    key: 'calculate',
    label: '成本计算',
    description: '计算人力成本、生成报价',
  },
] as const

type WorkflowStepKey = (typeof WORKFLOW_STEPS)[number]['key']

// 步骤顺序映射，用于确定哪些步骤已完成
const STEP_ORDER: Record<string, number> = {
  analyze: 0,
  breakdown: 1,
  estimate: 2,
  calculate: 3,
  complete: 4,
}

// 工作流结果类型（从服务端复制，避免导入服务端模块）
interface WorkflowResult {
  success: boolean
  analysis: unknown
  functions: unknown[]
  estimation: { totalHours?: number } | null
  cost: { totalCost?: number } | null
  error: string | null
}

interface AgentProgressProps {
  projectId: string
  requirementId: string
  onComplete?: (result: WorkflowResult) => void
}

type RunState = 'idle' | 'running' | 'success' | 'error'

export function AgentProgress({
  projectId,
  requirementId,
  onComplete,
}: AgentProgressProps) {
  const router = useRouter()
  const [runState, setRunState] = useState<RunState>('idle')
  const [currentStep, setCurrentStep] = useState<WorkflowStepKey | null>(null)
  const [completedSteps, setCompletedSteps] = useState<WorkflowStepKey[]>([])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<WorkflowResult | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // 计算进度百分比
  const progress = (completedSteps.length / WORKFLOW_STEPS.length) * 100

  // 解析 SSE 事件
  const parseSSEEvent = (chunk: string): Array<{ event: string; data: unknown }> => {
    const events: Array<{ event: string; data: unknown }> = []
    const lines = chunk.split('\n')
    let currentEvent = ''
    let currentData = ''

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7)
      } else if (line.startsWith('data: ')) {
        currentData = line.slice(6)
      } else if (line === '' && currentEvent && currentData) {
        try {
          events.push({ event: currentEvent, data: JSON.parse(currentData) })
        } catch {
          console.warn('Failed to parse SSE data:', currentData)
        }
        currentEvent = ''
        currentData = ''
      }
    }

    return events
  }

  // 运行工作流（使用流式 API）
  const runWorkflow = async () => {
    if (runState === 'running') return

    // 重置状态
    setRunState('running')
    setError(null)
    setCompletedSteps([])
    setCurrentStep('analyze')

    // 创建 AbortController 用于取消请求
    abortControllerRef.current = new AbortController()

    try {
      const response = await fetch('/api/agent/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, requirementId }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || '工作流执行失败')
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('无法读取响应流')
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // 解析完整的 SSE 事件
        const events = parseSSEEvent(buffer)

        for (const { event, data } of events) {
          const eventData = data as {
            step?: string
            isComplete?: boolean
            error?: string
            success?: boolean
            data?: WorkflowResult
          }

          if (event === 'progress') {
            const step = eventData.step as string

            // 更新当前步骤
            if (step && step !== 'complete') {
              setCurrentStep(step as WorkflowStepKey)

              // 标记之前的步骤为已完成
              const currentStepIndex = STEP_ORDER[step] ?? -1
              const completed = WORKFLOW_STEPS
                .filter((_, index) => index < currentStepIndex)
                .map((s) => s.key)
              setCompletedSteps(completed)
            }
          } else if (event === 'complete') {
            // 工作流完成
            setCompletedSteps(WORKFLOW_STEPS.map((s) => s.key))
            setCurrentStep(null)
            setRunState('success')

            if (eventData.data) {
              setResult(eventData.data)

              toast.success('分析完成', {
                description: '售前成本估算已完成，请查看结果',
              })

              // 回调通知
              if (onComplete) {
                onComplete(eventData.data)
              }
            }

            // 刷新页面数据
            router.refresh()
          } else if (event === 'error') {
            throw new Error(eventData.error || '工作流执行失败')
          }
        }

        // 清空已处理的事件
        const lastDoubleNewline = buffer.lastIndexOf('\n\n')
        if (lastDoubleNewline !== -1) {
          buffer = buffer.slice(lastDoubleNewline + 2)
        }
      }
    } catch (err) {
      // 忽略取消错误
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }

      console.error('工作流执行失败:', err)
      setRunState('error')
      setError(err instanceof Error ? err.message : '执行失败')
      setCurrentStep(null)

      toast.error('分析失败', {
        description: err instanceof Error ? err.message : '请重试',
      })
    } finally {
      abortControllerRef.current = null
    }
  }

  // 获取步骤图标
  const getStepIcon = (stepKey: WorkflowStepKey) => {
    const isCompleted = completedSteps.includes(stepKey)
    const isCurrent = currentStep === stepKey

    if (isCompleted) {
      return <CheckCircle className="h-5 w-5 text-green-500" />
    }
    if (isCurrent) {
      return <Loader2 className="h-5 w-5 animate-spin text-primary" />
    }
    return <Circle className="h-5 w-5 text-muted-foreground/30" />
  }

  // 获取步骤状态样式
  const getStepStyle = (stepKey: WorkflowStepKey) => {
    const isCompleted = completedSteps.includes(stepKey)
    const isCurrent = currentStep === stepKey

    if (isCompleted) return 'text-foreground'
    if (isCurrent) return 'text-foreground'
    return 'text-muted-foreground'
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI 分析
          </span>
          {runState === 'running' && (
            <Badge variant="secondary" className="animate-pulse">
              分析中...
            </Badge>
          )}
          {runState === 'success' && (
            <Badge variant="default" className="bg-green-500">
              已完成
            </Badge>
          )}
          {runState === 'error' && (
            <Badge variant="destructive">失败</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 进度条 */}
        {runState === 'running' && (
          <div className="space-y-2">
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              {Math.round(progress)}% 完成
            </p>
          </div>
        )}

        {/* 步骤列表 */}
        <div className="space-y-3">
          {WORKFLOW_STEPS.map((step, index) => (
            <div
              key={step.key}
              className={`flex items-center gap-3 transition-opacity ${
                runState === 'idle' ? 'opacity-50' : ''
              }`}
            >
              {getStepIcon(step.key)}
              <div className="flex-1">
                <p className={`font-medium ${getStepStyle(step.key)}`}>
                  {step.label}
                </p>
                <p className="text-xs text-muted-foreground">
                  {step.description}
                </p>
              </div>
              {completedSteps.includes(step.key) && (
                <Badge variant="secondary" className="text-xs">
                  完成
                </Badge>
              )}
            </div>
          ))}
        </div>

        {/* 错误信息 */}
        {runState === 'error' && error && (
          <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-600">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 成功信息 */}
        {runState === 'success' && result && (
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
            <p className="font-medium mb-1">分析完成</p>
            <ul className="list-disc list-inside text-xs space-y-0.5">
              <li>识别 {result.functions?.length || 0} 个功能模块</li>
              <li>
                预估总工时 {result.estimation?.totalHours || 0} 小时
              </li>
              <li>
                预估总成本 ¥{result.cost?.totalCost?.toLocaleString() || 0}
              </li>
            </ul>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-2">
          <Button
            onClick={runWorkflow}
            disabled={runState === 'running'}
            className="flex-1"
          >
            {runState === 'running' ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                分析中...
              </>
            ) : runState === 'success' || runState === 'error' ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                重新分析
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                开始分析
              </>
            )}
          </Button>
        </div>

        {/* 提示信息 */}
        {runState === 'idle' && (
          <p className="text-xs text-muted-foreground text-center">
            点击"开始分析"，AI 将自动分析需求并生成成本估算
          </p>
        )}
      </CardContent>
    </Card>
  )
}
