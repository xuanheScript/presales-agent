'use client'

import { useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  MessageCircle,
  Trash2,
  Bot,
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

interface AgentChatProps {
  projectId: string
  className?: string
}

export function AgentChat({ projectId, className }: AgentChatProps) {
  const [input, setInput] = useState('')

  const { messages, sendMessage, status, setMessages } = useChat({
    id: `project-${projectId}`,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: { projectId },
    }),
  })

  const isLoading = status === 'streaming' || status === 'submitted'

  // 处理提交
  const handleSubmit = (message: PromptInputMessage) => {
    if (message.text.trim() && !isLoading) {
      sendMessage({ text: message.text })
      setInput('')
    }
  }

  // 清空对话
  const clearChat = () => {
    setMessages([])
  }

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
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
            {isLoading && (
              <Badge variant="secondary" className="animate-pulse">
                思考中...
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col min-h-0 p-0">
        {/* 消息列表 */}
        <div className="flex-1 px-4 min-h-0">
          <Conversation className="h-full">
            <ConversationContent className="gap-4">
              {messages.length === 0 ? (
                <ConversationEmptyState
                  icon={<Bot className="size-12" />}
                  title="开始对话"
                  description="你好！我是售前顾问助手。我已经了解了你的项目信息，有什么需要我帮你澄清或补充的吗？你可以问我关于需求、技术方案、成本估算等任何问题。"
                />
              ) : (
                <>
                  {messages.map((message) => (
                    <Message from={message.role} key={message.id}>
                      <MessageContent>
                        {message.parts.map((part, i) => {
                          switch (part.type) {
                            case 'text':
                              return (
                                <MessageResponse key={`${message.id}-${i}`}>
                                  {part.text}
                                </MessageResponse>
                              )
                            default:
                              return null
                          }
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
        <div className="border-t p-4">
          <PromptInput
            onSubmit={handleSubmit}
            className="w-full"
          >
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder="输入你的问题... (Enter 发送, Shift+Enter 换行)"
              disabled={isLoading}
              className="min-h-[44px] max-h-[120px]"
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit
                status={status}
                disabled={!input.trim() || isLoading}
              />
            </PromptInputFooter>
          </PromptInput>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            与 AI 对话来补充和澄清需求细节
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
