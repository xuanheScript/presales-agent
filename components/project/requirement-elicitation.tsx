'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { Bot, CheckCircle2, Loader2, MessageCircle, RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { ElicitationAnswer, ElicitationQuestion, ElicitationSession } from '@/types'
import {
  createElicitationSession,
  getActiveElicitationSession,
  getElicitationSessionWithMessages,
  getLatestElicitationSession,
  getOrCreateElicitationSession,
} from '@/app/actions/elicitation-sessions'
import { QuestionCards } from '@/components/elicitation/question-cards'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'

interface RequirementElicitationProps {
  projectId: string
  initialSessionId?: string | null
  disabled?: boolean
}

export function RequirementElicitation({
  projectId,
  initialSessionId,
  disabled = false,
}: RequirementElicitationProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState<ElicitationSession | null>(null)
  const [loadingSession, setLoadingSession] = useState(false)
  const [complete, setComplete] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [questions, setQuestions] = useState<ElicitationQuestion[]>([])
  const [assistantMessage, setAssistantMessage] = useState('')
  const [submittingAnswers, setSubmittingAnswers] = useState(false)
  const pendingStartRef = useRef(false)

  const loadSession = useCallback(async () => {
    setLoadingSession(true)
    try {
      const active = await getActiveElicitationSession(projectId)
      if (active) {
        setSession(active)
        setComplete(false)
        if (active.current_round > 0) {
          const history = await getElicitationSessionWithMessages(active.id)
          const latestAssistant = history?.messages
            .filter((message) => message.role === 'assistant')
            .pop()
          setAssistantMessage(latestAssistant?.content ?? '')
          setQuestions(latestAssistant?.questions ?? active.current_questions ?? [])
        } else {
          setAssistantMessage('')
          setQuestions([])
        }
        return
      }
      const latest = await getLatestElicitationSession(projectId)
      if (latest?.status === 'completed') {
        setSession(latest)
        setComplete(true)
      } else {
        setSession(null)
        setComplete(false)
      }
    } finally {
      setLoadingSession(false)
    }
  }, [projectId])

  useEffect(() => {
    if (!open) return
    void loadSession()
  }, [loadSession, open, initialSessionId])

  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/chat',
    body: {
      projectId,
      mode: 'elicitation',
      elicitationSessionId: session?.id,
    },
  }), [projectId, session?.id])

  const { messages, sendMessage, setMessages, status } = useChat({
    id: `requirement-elicitation-${projectId}`,
    transport,
    onFinish: async ({ messages: finalMessages }) => {
      const latestAssistant = finalMessages.filter((message) => message.role === 'assistant').pop()
      if (latestAssistant) {
        const text = latestAssistant.parts
          ?.filter((part) => part.type === 'text')
          .map((part) => (part as { type: 'text'; text: string }).text)
          .join('') ?? ''
        setAssistantMessage(text)

        for (const part of latestAssistant.parts ?? []) {
          const toolPart = part as { type: string; state?: string; output?: { questions?: ElicitationQuestion[] } }
          if (
            toolPart.type === 'tool-generateQuestions'
            && toolPart.state === 'output-available'
            && toolPart.output?.questions
          ) {
            setQuestions(toolPart.output.questions)
            break
          }
        }
      }
      await loadSession()
    },
  })

  const chatLoading = status === 'streaming' || status === 'submitted'
  const streamingMessage = useMemo(() => {
    const latestAssistant = messages.filter((message) => message.role === 'assistant').pop()
    return latestAssistant?.parts
      ?.filter((part) => part.type === 'text')
      .map((part) => (part as { type: 'text'; text: string }).text)
      .join('') ?? ''
  }, [messages])
  const displayedMessage = status === 'streaming' ? streamingMessage : assistantMessage

  useEffect(() => {
    if (!pendingStartRef.current || !session?.id || chatLoading) return
    pendingStartRef.current = false
    void sendMessage({ text: '请根据当前项目需求，引导我补充缺失的关键信息。' })
  }, [chatLoading, sendMessage, session?.id])

  async function startSession(forceNew = false) {
    if (chatLoading || loadingSession) return
    setLoadingSession(true)
    try {
      const nextSession = forceNew
        ? await createElicitationSession(projectId)
        : await getOrCreateElicitationSession(projectId)
      if (!nextSession) {
        toast.error('创建需求澄清会话失败')
        return
      }
      setSession(nextSession)
      setComplete(false)
      setMessages([])
      setQuestions([])
      setAssistantMessage('')
      pendingStartRef.current = true
    } finally {
      setLoadingSession(false)
    }
  }

  function submitAnswers(answers: ElicitationAnswer[]) {
    if (!session || chatLoading) return
    setSubmittingAnswers(true)
    const content = answers.map((answer) => {
      const question = questions.find((candidate) => candidate.id === answer.questionId)
      const selected = answer.selectedOptions.join('、')
      const supplement = answer.customInput ? `（补充：${answer.customInput}）` : ''
      return `${question?.question ?? '问题'}：${selected}${supplement}`
    }).join('\n')
    setQuestions([])
    setAssistantMessage('')
    setSubmittingAnswers(false)
    void sendMessage({ text: content })
  }

  async function finishSession() {
    if (!session || completing) return
    setCompleting(true)
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [],
          projectId,
          mode: 'elicitation',
          elicitationSessionId: session.id,
          userWantsToComplete: true,
        }),
      })
      const body = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error || '完成需求澄清失败')
      setComplete(true)
      toast.success('需求澄清已完成', {
        description: '澄清结果已保存为待确认需求来源。',
      })
      await loadSession()
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '完成需求澄清失败')
    } finally {
      setCompleting(false)
    }
  }

  const progress = session ? (session.current_round / session.max_rounds) * 100 : 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="h-auto w-full justify-start gap-3 py-3"
          disabled={disabled}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
            <MessageCircle className="h-4 w-4" />
          </span>
          <span className="text-left">
            <span className="block font-medium">AI 需求澄清</span>
            <span className="block text-xs font-normal text-muted-foreground">
              {initialSessionId ? '继续回答关键问题' : '通过引导问题补齐需求'}
            </span>
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>AI 需求澄清</DialogTitle>
          <DialogDescription>
            这里只负责补齐需求信息；完成后仍需在工作台确认，才会进入正式方案与成本分析。
          </DialogDescription>
        </DialogHeader>

        {loadingSession && !session ? (
          <div className="flex min-h-48 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />加载澄清会话
          </div>
        ) : complete ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>本轮需求澄清已完成</AlertTitle>
            <AlertDescription className="mt-2 space-y-3">
              <p>澄清结果已保存在需求来源中。关闭窗口后可检查并确认当前需求。</p>
              <Button size="sm" variant="outline" onClick={() => void startSession(true)}>
                <RefreshCw className="h-4 w-4" />开始新一轮澄清
              </Button>
            </AlertDescription>
          </Alert>
        ) : !session || (session.current_round === 0 && messages.length === 0 && !chatLoading) ? (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base">从当前需求开始</CardTitle>
              <CardDescription>
                AI 会围绕目标、范围、关键角色、约束和验收标准分轮提问。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => void startSession()} disabled={loadingSession}>
                {loadingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                开始需求澄清
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>信息收集进度</span>
                <span>{session.current_round}/{session.max_rounds} 轮</span>
              </div>
              <Progress value={progress} className="h-1.5" />
            </div>

            {(displayedMessage || chatLoading) ? (
              <div className="flex gap-3 rounded-lg bg-muted/60 p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background">
                  <Bot className="h-4 w-4 text-primary" />
                </span>
                <p className="whitespace-pre-wrap text-sm leading-6">
                  {displayedMessage || '正在整理下一组问题…'}
                </p>
              </div>
            ) : null}

            {questions.length > 0 && !chatLoading ? (
              <QuestionCards
                key={`${session.id}-${session.current_round}`}
                questions={questions}
                onSubmit={submitAnswers}
                isSubmitting={submittingAnswers}
              />
            ) : null}

            {chatLoading && questions.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />正在生成引导问题
              </div>
            ) : null}

            {messages.length > 0 ? (
              <div className="flex justify-end border-t pt-4">
                <Button variant="outline" size="sm" onClick={() => void finishSession()} disabled={completing || chatLoading}>
                  {completing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  结束澄清并保存
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
