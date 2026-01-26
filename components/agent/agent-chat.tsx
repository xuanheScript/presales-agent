'use client'

import { useState, useEffect, useCallback } from 'react'
import { useChat, type UIMessage } from '@ai-sdk/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  MessageCircle,
  Trash2,
  Bot,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
  PanelLeftClose,
  PanelLeft,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { DefaultChatTransport } from 'ai'

// AI Elements 组件
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { Loader } from '@/components/ai-elements/loader'

// 会话管理
import { ChatSessionList } from './chat-session-list'
import type { ChatSession } from '@/types'
import {
  getChatSessions,
  getChatSession,
  createChatSession,
} from '@/app/actions/chat-sessions'

interface AgentChatProps {
  projectId: string
  className?: string
}

// 工具名称映射
const toolNameMap: Record<string, string> = {
  updateRequirement: '更新需求',
  appendRequirement: '追加需求',
  updateParsedRequirement: '更新需求分析',
  addFunctionModule: '添加功能模块',
  addFunctionModulesBatch: '批量添加功能',
  updateFunctionHours: '更新功能工时',
  updateFunctionDifficulty: '更新功能难度',
  deleteFunctionModule: '删除功能模块',
  addFromLibrary: '从功能库添加',
  updateCostParameters: '更新成本参数',
  recalculateCost: '重新计算成本',
  updateProjectDescription: '更新项目描述',
  updateProjectIndustry: '更新项目行业',
  getFunctionModules: '查询功能列表',
  getCostSummary: '查询成本汇总',
  searchFunctionLibrary: '搜索功能库',
  getProjectSummary: '查询项目汇总',
  getSystemConfig: '查询成本配置',
}

// 工具调用状态组件
function ToolInvocationPart({ part }: { part: {
  type: string
  toolCallId: string
  state: string
  input?: unknown
  output?: unknown
  errorText?: string
} }) {
  // 从 type 中提取工具名称 (格式: tool-{toolName})
  const toolName = part.type.startsWith('tool-') ? part.type.slice(5) : part.type
  const toolDisplayName = toolNameMap[toolName] || toolName

  const isResult = part.state === 'output-available'
  const isStreaming = part.state === 'input-streaming' || part.state === 'input-available'
  const hasError = !!part.errorText

  const result = part.output as { success?: boolean; message?: string; error?: string } | undefined

  return (
    <div className="flex items-start gap-2 py-1.5 px-3 rounded-md bg-muted/50 text-sm my-1">
      <div className="mt-0.5">
        {isResult ? (
          hasError || result?.success === false ? (
            <XCircle className="h-4 w-4 text-red-500" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          )
        ) : isStreaming ? (
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        ) : (
          <Wrench className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{toolDisplayName}</span>
          {isResult && (
            <Badge
              variant={hasError || result?.success === false ? 'destructive' : 'default'}
              className="text-xs py-0"
            >
              {hasError || result?.success === false ? '失败' : '成功'}
            </Badge>
          )}
        </div>
        {isResult && result?.message && (
          <p className="text-muted-foreground text-xs mt-0.5">{result.message}</p>
        )}
        {(hasError || (isResult && result?.error)) && (
          <p className="text-red-500 text-xs mt-0.5">{part.errorText || result?.error}</p>
        )}
      </div>
    </div>
  )
}

// 检查是否是工具调用 part
function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith('tool-')
}

export function AgentChat({ projectId, className }: AgentChatProps) {
  const [input, setInput] = useState('')
  const [showSidebar, setShowSidebar] = useState(true)
  const [isExpanded, setIsExpanded] = useState(false)

  // 会话管理状态
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([])
  const [isLoadingSessions, setIsLoadingSessions] = useState(true)

  // 加载会话列表
  const loadSessions = useCallback(async () => {
    setIsLoadingSessions(true)
    try {
      const data = await getChatSessions(projectId)
      setSessions(data)

      // 如果没有当前会话，选择第一个或创建新的
      if (!currentSessionId && data.length > 0) {
        await handleSelectSession(data[0].id)
      } else if (!currentSessionId && data.length === 0) {
        // 自动创建第一个会话
        await handleNewSession()
      }
    } catch (error) {
      console.error('加载会话失败:', error)
    } finally {
      setIsLoadingSessions(false)
    }
  }, [projectId, currentSessionId])

  // 初始加载
  useEffect(() => {
    loadSessions()
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ESC 键退出全屏
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isExpanded) {
        setIsExpanded(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isExpanded])

  // 创建新会话
  const handleNewSession = async () => {
    try {
      const session = await createChatSession(projectId)
      if (session) {
        setSessions(prev => [session, ...prev])
        setCurrentSessionId(session.id)
        setInitialMessages([])
        setMessages([])
      }
    } catch (error) {
      console.error('创建会话失败:', error)
    }
  }

  // 选择历史会话
  const handleSelectSession = async (sessionId: string) => {
    if (sessionId === currentSessionId) return

    try {
      const data = await getChatSession(sessionId)
      if (data) {
        setCurrentSessionId(sessionId)
        setInitialMessages(data.messages)
        setMessages(data.messages)
      }
    } catch (error) {
      console.error('加载会话失败:', error)
    }
  }

  // 会话删除后的处理
  const handleSessionDeleted = () => {
    // 重新加载会话列表
    loadSessions()
    // 如果删除的是当前会话，清空状态
    if (sessions.find(s => s.id === currentSessionId) === undefined) {
      setCurrentSessionId(null)
      setInitialMessages([])
    }
  }

  const { messages, sendMessage, status, setMessages } = useChat({
    id: currentSessionId || `project-${projectId}-temp`,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: { projectId, sessionId: currentSessionId },
    }),
    onFinish: () => {
      // 对话完成后，检查是否需要刷新会话列表（用于更新标题）
      const currentSession = sessions.find(s => s.id === currentSessionId)
      if (currentSession && !currentSession.title) {
        loadSessions()
      }
    },
  })

  const isLoading = status === 'streaming' || status === 'submitted'

  // 处理提交
  const handleSubmit = (message: PromptInputMessage) => {
    if (message.text.trim() && !isLoading) {
      sendMessage({ text: message.text })
      setInput('')
    }
  }

  // 清空当前对话
  const clearChat = () => {
    setMessages([])
  }

  // 容器样式：普通模式 vs 全屏模式
  const containerClassName = isExpanded
    ? 'fixed inset-0 z-50 bg-background flex flex-col'
    : cn('flex flex-col', className)

  // 侧边栏宽度：全屏模式更宽
  const sidebarWidth = isExpanded ? 'w-56' : 'w-48'

  return (
    <Card className={containerClassName}>
      <CardHeader className="pb-3 shrink-0">
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setShowSidebar(!showSidebar)}
            >
              {showSidebar ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeft className="h-4 w-4" />
              )}
            </Button>
            <MessageCircle className="h-5 w-5" />
            需求澄清对话
          </span>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearChat}
                disabled={isLoading}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? '缩小视图 (Esc)' : '扩大视图'}
            >
              {isExpanded ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
            {isLoading && (
              <Badge variant="secondary" className="animate-pulse">
                思考中...
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 flex min-h-0 p-0">
        {/* 会话列表侧边栏 */}
        {showSidebar && (
          <div className={cn(sidebarWidth, 'shrink-0')}>
            <ChatSessionList
              sessions={sessions}
              currentSessionId={currentSessionId}
              onSelectSession={handleSelectSession}
              onNewSession={handleNewSession}
              onSessionDeleted={handleSessionDeleted}
              isLoading={isLoadingSessions}
            />
          </div>
        )}

        {/* 主对话区域 */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* 消息列表 */}
          <div className={cn('flex-1 min-h-0', isExpanded ? 'px-6' : 'px-4')}>
            <Conversation className="h-full">
              <ConversationContent className="gap-4">
                {messages.length === 0 ? (
                  <ConversationEmptyState
                    icon={<Bot className="size-12" />}
                    title="开始对话"
                    description="你好！我是售前顾问助手。我已经了解了你的项目信息，有什么需要我帮你澄清或补充的吗？你可以问我关于需求、技术方案、成本估算等任何问题。我还可以帮你保存确认的信息。"
                  />
                ) : (
                  <>
                    {messages.map((message) => (
                      <Message from={message.role} key={message.id}>
                        <MessageContent>
                          {message.parts.map((part, i) => {
                            if (part.type === 'text') {
                              return (
                                <MessageResponse key={`${message.id}-${i}`}>
                                  {part.text}
                                </MessageResponse>
                              )
                            }

                            if (isToolPart(part)) {
                              return (
                                <ToolInvocationPart
                                  key={`${message.id}-${i}`}
                                  part={part as {
                                    type: string
                                    toolCallId: string
                                    state: string
                                    input?: unknown
                                    output?: unknown
                                    errorText?: string
                                  }}
                                />
                              )
                            }

                            return null
                          })}
                        </MessageContent>
                      </Message>
                    ))}
                    {/* 加载指示器 */}
                    {isLoading && messages[messages.length - 1]?.role === 'user' && (
                      <Message from="assistant">
                        <MessageContent>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Loader size={16} />
                            <span className="text-sm">正在思考...</span>
                          </div>
                        </MessageContent>
                      </Message>
                    )}
                  </>
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          </div>

          {/* 输入区域 */}
          <div className="border-t p-4 shrink-0">
            <PromptInput
              onSubmit={handleSubmit}
              className={cn('w-full', isExpanded && 'max-w-4xl mx-auto')}
            >
              <PromptInputTextarea
                value={input}
                onChange={(e) => setInput(e.currentTarget.value)}
                placeholder="输入你的问题... (Enter 发送, Shift+Enter 换行)"
                disabled={isLoading || !currentSessionId}
                className={cn(
                  isExpanded ? 'min-h-[60px] max-h-[200px]' : 'min-h-[44px] max-h-[120px]'
                )}
              />
              <PromptInputFooter className="justify-end">
                <PromptInputSubmit
                  status={status}
                  disabled={!input.trim() || isLoading || !currentSessionId}
                />
              </PromptInputFooter>
            </PromptInput>
            {!isExpanded && (
              <p className="text-xs text-muted-foreground mt-2 text-center">
                与 AI 对话来补充和澄清需求细节，确认的信息会自动保存
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
