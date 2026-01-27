'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useChat, type UIMessage } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  CheckCircle,
  Circle,
  Loader2,
  AlertCircle,
  Sparkles,
  RefreshCw,
  Zap,
  MessageCircle,
  ArrowLeft,
  Bot,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ElicitationSession, ElicitationQuestion, ElicitationAnswer } from '@/types'
import {
  getActiveElicitationSession,
  getLatestElicitationSession,
  getOrCreateElicitationSession,
} from '@/app/actions/elicitation-sessions'
import { QuestionCards } from '@/components/elicitation/question-cards'

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

// 分析模式类型
type AnalysisMode = 'quick' | 'professional' | null

// 步骤顺序映射，用于确定哪些步骤已完成
const STEP_ORDER: Record<string, number> = {
  analyze: 0,
  breakdown: 1,
  estimate: 2,
  calculate: 3,
  complete: 4,
}

// 功能模块类型（用于计算工时）
interface FunctionModule {
  estimatedHours: number
  difficultyLevel: 'simple' | 'medium' | 'complex' | 'very_complex'
}

// 难度系数（与 constants 保持一致）
const DIFFICULTY_MULTIPLIERS: Record<string, number> = {
  simple: 1.0,
  medium: 1.5,
  complex: 2.5,
  very_complex: 4.0,
}

// 工作流结果类型（从服务端复制，避免导入服务端模块）
interface WorkflowResult {
  success: boolean
  analysis: unknown
  functions: FunctionModule[]
  estimation: { breakdownRatio?: { development: number; testing: number; integration: number } } | null
  cost: { totalCost?: number } | null
  error: string | null
}

// 计算加权工时
function calculateWeightedHours(functions: FunctionModule[]): number {
  return functions.reduce((sum, fn) => {
    const multiplier = DIFFICULTY_MULTIPLIERS[fn.difficultyLevel] || 1
    return sum + fn.estimatedHours * multiplier
  }, 0)
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

  // 模式选择状态
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>(null)

  // 工作流状态
  const [runState, setRunState] = useState<RunState>('idle')
  const [currentStep, setCurrentStep] = useState<WorkflowStepKey | null>(null)
  const [completedSteps, setCompletedSteps] = useState<WorkflowStepKey[]>([])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<WorkflowResult | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // 引导模式状态
  const [elicitationSession, setElicitationSession] = useState<ElicitationSession | null>(null)
  const [isElicitationComplete, setIsElicitationComplete] = useState(false)
  const [isCompletingElicitation, setIsCompletingElicitation] = useState(false)
  const [hasTriggeredFirstMessage, setHasTriggeredFirstMessage] = useState(false)
  const [currentQuestions, setCurrentQuestions] = useState<ElicitationQuestion[]>([])
  const [isSubmittingAnswers, setIsSubmittingAnswers] = useState(false)
  const [aiMessage, setAiMessage] = useState<string>('')
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false)

  // 使用 ref 追踪最新的 session id，确保 transport 更新后再发送消息
  const sessionIdRef = useRef<string | null>(null)
  const pendingSendRef = useRef(false)

  // 同步更新 ref
  useEffect(() => {
    sessionIdRef.current = elicitationSession?.id || null
  }, [elicitationSession?.id])

  // 加载 Elicitation 会话状态
  const loadElicitationState = useCallback(async () => {
    try {
      // 先尝试获取活跃会话（已开始的，current_round > 0）
      const activeSession = await getActiveElicitationSession(projectId)

      if (activeSession && activeSession.current_round > 0) {
        // 只有已开始的活跃会话才恢复
        setElicitationSession(activeSession)
        setIsElicitationComplete(false)
        return
      }

      // 检查是否有已完成的会话
      const latestSession = await getLatestElicitationSession(projectId)

      if (latestSession) {
        setElicitationSession(latestSession)
        if (latestSession.status === 'completed') {
          setIsElicitationComplete(true)
        }
      }
    } catch (error) {
      console.error('加载 Elicitation 状态失败:', error)
    }
  }, [projectId])

  // 初始化引导模式，返回创建的会话
  const initElicitation = useCallback(async (): Promise<ElicitationSession | null> => {
    try {
      const session = await getOrCreateElicitationSession(projectId)
      if (session) {
        setElicitationSession(session)
        return session
      }
      return null
    } catch (error) {
      console.error('创建 Elicitation 会话失败:', error)
      toast.error('创建引导会话失败')
      return null
    }
  }, [projectId])

  // 选择模式处理
  const handleSelectMode = async (mode: AnalysisMode) => {
    setAnalysisMode(mode)

    if (mode === 'professional') {
      // 只加载现有会话状态，不创建新会话
      await loadElicitationState()
    }
  }

  // 返回模式选择
  const handleBackToModeSelection = () => {
    setAnalysisMode(null)
    setElicitationSession(null)
    setIsElicitationComplete(false)
  }

  // 使用 useMemo 确保 transport 随 elicitationSession 变化而更新
  const chatTransport = useMemo(() => new DefaultChatTransport({
    api: '/api/chat',
    body: {
      projectId,
      mode: 'elicitation',
      elicitationSessionId: elicitationSession?.id,
    },
  }), [projectId, elicitationSession?.id])

  // useChat for elicitation - 使用固定 id 避免状态重置问题
  const {
    messages,
    sendMessage,
    status: chatStatus,
    setMessages,
  } = useChat({
    id: `elicitation-${projectId}`,
    transport: chatTransport,
    onFinish: async ({ messages: finalMessages }) => {
      // 刷新会话状态
      await loadElicitationState()

      // 从最后一条 assistant 消息中提取问题
      const lastAssistantMessage = finalMessages.filter(m => m.role === 'assistant').pop()
      if (lastAssistantMessage) {
        // 提取文本消息
        const textParts = lastAssistantMessage.parts?.filter(p => p.type === 'text') || []
        const textContent = textParts.map(p => (p as { type: 'text'; text: string }).text).join('')
        if (textContent) {
          setAiMessage(textContent)
        }

        // 从工具调用结果中提取问题
        const toolParts = lastAssistantMessage.parts?.filter(p =>
          p.type.startsWith('tool-') &&
          (p as { state?: string }).state === 'output-available'
        ) || []

        for (const part of toolParts) {
          const toolPart = part as { type: string; output?: { questions?: ElicitationQuestion[] } }
          if (toolPart.type === 'tool-generateQuestions' && toolPart.output?.questions) {
            setCurrentQuestions(toolPart.output.questions)
            break
          }
        }
      }
    },
  })

  const isChatLoading = chatStatus === 'streaming' || chatStatus === 'submitted'
  const isStreaming = chatStatus === 'streaming'

  // 从 messages 中实时提取 AI 的文字内容（用于流式显示）
  const streamingAiMessage = useMemo(() => {
    const lastAssistantMessage = messages.filter(m => m.role === 'assistant').pop()
    if (!lastAssistantMessage) return ''

    const textParts = lastAssistantMessage.parts?.filter(p => p.type === 'text') || []
    return textParts.map(p => (p as { type: 'text'; text: string }).text).join('')
  }, [messages])

  // 显示的 AI 消息：流式传输时用实时数据，完成后用保存的数据
  const displayAiMessage = isStreaming ? streamingAiMessage : aiMessage

  // 处理用户回答选项问题
  const handleSubmitAnswers = (answers: ElicitationAnswer[]) => {
    if (!elicitationSession || isChatLoading) return

    setIsSubmittingAnswers(true)

    // 将用户的回答转换为文本消息
    const answerTexts = answers.map(answer => {
      const question = currentQuestions.find(q => q.id === answer.questionId)
      const selectedLabels = answer.selectedOptions.join('、')
      const customText = answer.customInput ? `（补充：${answer.customInput}）` : ''
      return `${question?.question || '问题'}: ${selectedLabels}${customText}`
    })

    const messageText = answerTexts.join('\n')

    // 清空当前问题
    setCurrentQuestions([])
    setAiMessage('')
    setIsSubmittingAnswers(false)

    // 发送消息给 AI
    sendMessage({ text: messageText })
  }

  // 点击完成引导按钮（用户主动结束，需要确认）
  const handleCompleteElicitation = () => {
    if (!elicitationSession) return
    setShowCompleteConfirm(true)
  }

  // 实际执行完成引导
  const doCompleteElicitation = async () => {
    if (!elicitationSession) return

    setShowCompleteConfirm(false)
    setIsCompletingElicitation(true)
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [],
          projectId,
          mode: 'elicitation',
          elicitationSessionId: elicitationSession.id,
          userWantsToComplete: true,
        }),
      })

      if (response.ok) {
        setIsElicitationComplete(true)
        toast.success('需求引导完成', {
          description: '现在可以开始 AI 分析了',
        })
        router.refresh()
      } else {
        const data = await response.json()
        toast.error(data.error || '完成引导失败')
      }
    } catch (error) {
      console.error('完成 Elicitation 失败:', error)
      toast.error('完成引导失败')
    } finally {
      setIsCompletingElicitation(false)
    }
  }


  // 当 transport 更新后（session id 变化），检查是否有待发送的消息
  useEffect(() => {
    if (pendingSendRef.current && elicitationSession?.id && !isChatLoading && messages.length === 0) {
      // 等待下一个微任务，确保 useMemo 的 transport 已经更新
      Promise.resolve().then(() => {
        if (pendingSendRef.current) {
          pendingSendRef.current = false
          sendMessage({ text: '请开始引导我完善需求' })
        }
      })
    }
  }, [elicitationSession?.id, isChatLoading, messages.length, sendMessage])

  // 手动开始引导
  const handleStartElicitation = async () => {
    if (isChatLoading || hasTriggeredFirstMessage) return

    // 标记需要发送第一条消息
    setHasTriggeredFirstMessage(true)

    // 如果没有会话，创建一个
    if (!elicitationSession) {
      // 标记有待发送的消息
      pendingSendRef.current = true
      const session = await initElicitation()
      if (!session) {
        toast.error('创建引导会话失败，请重试')
        setHasTriggeredFirstMessage(false)
        pendingSendRef.current = false
        return
      }
      // session 状态更新后，useEffect 会检测到 pendingSendRef 并发送消息
    } else {
      // 已有会话，transport 已经包含正确的 sessionId，直接发送
      sendMessage({ text: '请开始引导我完善需求' })
    }
  }

  // 开始新的引导（重置状态并创建新会话）
  const handleStartNewElicitation = async () => {
    // 重置所有相关状态
    setIsElicitationComplete(false)
    setHasTriggeredFirstMessage(false)
    setMessages([])
    setCurrentQuestions([])
    setAiMessage('')
    setElicitationSession(null)
    pendingSendRef.current = false

    // 标记有待发送的消息，等待新会话创建后发送
    pendingSendRef.current = true
    setHasTriggeredFirstMessage(true)

    // 创建新会话
    const session = await initElicitation()
    if (!session) {
      toast.error('创建引导会话失败，请重试')
      setHasTriggeredFirstMessage(false)
      pendingSendRef.current = false
    }
    // session 状态更新后，useEffect 会检测到 pendingSendRef 并发送消息
  }

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

  // 渲染分析进度（共享组件）
  const renderAnalysisProgress = (options?: { showStartButton?: boolean }) => {
    const { showStartButton = true } = options || {}

    return (
      <div className="space-y-6">
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
          {WORKFLOW_STEPS.map((step) => (
            <div
              key={step.key}
              className={cn(
                'flex items-center gap-3 transition-opacity',
                runState === 'idle' && 'opacity-50'
              )}
            >
              {getStepIcon(step.key)}
              <div className="flex-1">
                <p className={cn('font-medium', getStepStyle(step.key))}>
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
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
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
                预估加权工时 {Math.round(calculateWeightedHours(result.functions || []))} 小时
              </li>
              <li>
                预估总成本 ¥{result.cost?.totalCost?.toLocaleString() || 0}
              </li>
            </ul>
          </div>
        )}

        {/* 操作按钮 */}
        {showStartButton && (
          <Button
            onClick={runWorkflow}
            disabled={runState === 'running'}
            className="w-full"
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
        )}
      </div>
    )
  }

  // 渲染模式选择界面
  const renderModeSelection = () => (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground text-center">
        选择分析模式，开始 AI 需求分析
      </p>

      <div className="grid grid-cols-1 gap-3">
        {/* 快速分析 */}
        <button
          onClick={() => handleSelectMode('quick')}
          className={cn(
            'group relative flex items-start gap-4 rounded-lg border p-4 text-left transition-all hover:border-primary hover:bg-primary/5',
            'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2'
          )}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Zap className="h-5 w-5" />
          </div>
          <div className="flex-1 space-y-1">
            <p className="font-medium">快速分析</p>
            <p className="text-sm text-muted-foreground">
              直接使用已填写的需求进行 AI 分析，快速得出结果
            </p>
          </div>
        </button>

        {/* 引导模式 */}
        <button
          onClick={() => handleSelectMode('professional')}
          className={cn(
            'group relative flex items-start gap-4 rounded-lg border p-4 text-left transition-all hover:border-primary hover:bg-primary/5',
            'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2'
          )}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div className="flex-1 space-y-1">
            <p className="font-medium">引导模式 (Socratic)</p>
            <p className="text-sm text-muted-foreground">
              通过多轮对话收集更完整的需求信息，确保分析结果更准确
            </p>
          </div>
        </button>
      </div>
    </div>
  )

  // 渲染引导模式界面
  const renderElicitationMode = () => (
    <div className="space-y-4">
      {/* 返回按钮 */}
      {!isElicitationComplete && messages.length === 0 && !isChatLoading && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBackToModeSelection}
          className="gap-1"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </Button>
      )}

      {/* 引导已完成，显示分析界面 */}
      {isElicitationComplete ? (
        <div className="space-y-4">
          {/* 引导完成提示 */}
          {runState === 'idle' && (
            <div className="rounded-md bg-green-50 p-4 text-sm text-green-700">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium mb-1">需求引导已完成</p>
                  <p className="text-xs">已收集完整的需求信息，可以开始 AI 分析了</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStartNewElicitation}
                  className="shrink-0 text-green-700 border-green-300 hover:bg-green-100"
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  重新引导
                </Button>
              </div>
            </div>
          )}
          {/* 分析进度 */}
          {renderAnalysisProgress()}
        </div>
      ) : (
        <div className="space-y-4">
          {/* AI 消息 - 流式显示 */}
          {(displayAiMessage || isStreaming) && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 bg-muted rounded-lg px-4 py-3 text-sm min-h-10">
                {displayAiMessage || (
                  <span className="text-muted-foreground">AI 正在思考...</span>
                )}
                {isStreaming && (
                  <span className="inline-block w-1.5 h-4 ml-0.5 bg-primary/60 animate-pulse" />
                )}
              </div>
            </div>
          )}

          {/* 加载状态 - 仅在没有任何消息时显示 */}
          {isChatLoading && !displayAiMessage && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Loader2 className="h-8 w-8 mb-4 animate-spin text-primary" />
              <p className="text-sm">AI 正在分析并生成问题...</p>
            </div>
          )}

          {/* 选项式问题卡片 */}
          {currentQuestions.length > 0 && !isChatLoading && (
            <QuestionCards
              questions={currentQuestions}
              onSubmit={handleSubmitAnswers}
              isSubmitting={isSubmittingAnswers}
            />
          )}

          {/* 空状态 - 等待用户点击开始 */}
          {!isChatLoading && currentQuestions.length === 0 && !aiMessage && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessageCircle className="h-12 w-12 mb-4 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground mb-4">AI 将根据您的需求生成引导问题</p>
              <Button
                onClick={handleStartElicitation}
                disabled={!elicitationSession}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                开始引导
              </Button>
            </div>
          )}

          {/* 底部操作栏 */}
          {messages.length > 0 && (
            <div className="flex justify-end pt-2 border-t">
              <Button
                onClick={handleCompleteElicitation}
                disabled={isCompletingElicitation || messages.length < 2}
                size="sm"
                variant="outline"
              >
                {isCompletingElicitation ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    完成中...
                  </>
                ) : (
                  '完成引导'
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )

  // 渲染快速分析流程
  const renderQuickMode = () => (
    <div className="space-y-6">
      {/* 返回按钮 */}
      {runState === 'idle' && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBackToModeSelection}
          className="gap-1"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </Button>
      )}

      {/* 分析进度 */}
      {renderAnalysisProgress()}
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI 分析
          </span>
          {analysisMode === 'professional' && !isElicitationComplete && (
            <Badge variant="secondary">引导模式</Badge>
          )}
          {analysisMode === 'quick' && runState === 'running' && (
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
      <CardContent>
        {/* 根据状态渲染不同界面 */}
        {analysisMode === null && renderModeSelection()}
        {analysisMode === 'quick' && renderQuickMode()}
        {analysisMode === 'professional' && renderElicitationMode()}
      </CardContent>

      {/* 提前完成确认对话框 */}
      <AlertDialog open={showCompleteConfirm} onOpenChange={setShowCompleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认提前完成引导？</AlertDialogTitle>
            <AlertDialogDescription>
              当前收集的需求信息可能不够完整，提前完成可能影响后续 AI 分析的准确性。
              <br /><br />
              建议继续回答问题以收集更多信息，或者确认已经提供了足够的需求描述。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续引导</AlertDialogCancel>
            <AlertDialogAction onClick={doCompleteElicitation}>
              确认完成
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
