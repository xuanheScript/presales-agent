'use client'

import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import type {
  ElicitationSession,
  ElicitationMessage,
  ElicitationCollectedInfo,
} from '@/types'
import { getCollectedFieldsCount } from '@/lib/ai/elicitation/progress'

interface SessionDetailProps {
  session: ElicitationSession
  messages: ElicitationMessage[]
  className?: string
}

const statusLabels: Record<ElicitationSession['status'], string> = {
  active: '进行中',
  completed: '已完成',
  cancelled: '已取消',
}

export function SessionDetail({
  session,
  messages,
  className,
}: SessionDetailProps) {
  const collectedInfo = (session.collected_info || {}) as ElicitationCollectedInfo
  const { filled, total } = getCollectedFieldsCount(collectedInfo)

  // 按轮次分组消息
  const messagesByRound = messages.reduce((acc, msg) => {
    const round = msg.round
    if (!acc[round]) acc[round] = []
    acc[round].push(msg)
    return acc
  }, {} as Record<number, ElicitationMessage[]>)

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">引导详情</CardTitle>
          <Badge variant="secondary">
            {statusLabels[session.status]}
          </Badge>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
          <span>已收集: {filled.length}/{total} 项</span>
          <span>轮次: {session.current_round}/{session.max_rounds}</span>
          <span>
            创建于: {format(new Date(session.created_at), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 收集的信息摘要 */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">收集的信息</h4>
          <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-2">
            {collectedInfo.projectType && (
              <div>
                <span className="text-muted-foreground">项目类型: </span>
                <span>{collectedInfo.projectType}</span>
              </div>
            )}
            {collectedInfo.projectSummary && (
              <div>
                <span className="text-muted-foreground">项目概述: </span>
                <span>{collectedInfo.projectSummary}</span>
              </div>
            )}
            {collectedInfo.businessGoals && collectedInfo.businessGoals.length > 0 && (
              <div>
                <span className="text-muted-foreground">业务目标: </span>
                <span>{collectedInfo.businessGoals.join('、')}</span>
              </div>
            )}
            {collectedInfo.keyFeatures && collectedInfo.keyFeatures.length > 0 && (
              <div>
                <span className="text-muted-foreground">核心功能: </span>
                <span>{collectedInfo.keyFeatures.join('、')}</span>
              </div>
            )}
            {collectedInfo.targetUsers && collectedInfo.targetUsers.length > 0 && (
              <div>
                <span className="text-muted-foreground">目标用户: </span>
                <span>{collectedInfo.targetUsers.join('、')}</span>
              </div>
            )}
            {collectedInfo.techStack && collectedInfo.techStack.length > 0 && (
              <div>
                <span className="text-muted-foreground">技术栈: </span>
                <span>{collectedInfo.techStack.join('、')}</span>
              </div>
            )}
            {collectedInfo.platforms && collectedInfo.platforms.length > 0 && (
              <div>
                <span className="text-muted-foreground">平台: </span>
                <span>{collectedInfo.platforms.join('、')}</span>
              </div>
            )}
            {collectedInfo.risks && collectedInfo.risks.length > 0 && (
              <div>
                <span className="text-muted-foreground">风险: </span>
                <span>{collectedInfo.risks.join('、')}</span>
              </div>
            )}
            {Object.keys(collectedInfo).filter(k => !k.startsWith('_')).length === 0 && (
              <p className="text-muted-foreground">暂无收集到的信息</p>
            )}
          </div>
        </div>

        <Separator />

        {/* 对话记录 */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">对话记录</h4>
          <ScrollArea className="h-[400px]">
            <div className="space-y-4 pr-4">
              {Object.entries(messagesByRound)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([round, roundMessages]) => (
                  <div key={round} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        第 {round} 轮
                      </Badge>
                      <Separator className="flex-1" />
                    </div>
                    {roundMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={cn(
                          'text-xs p-3 rounded-lg',
                          msg.role === 'assistant'
                            ? 'bg-muted/50 mr-8'
                            : 'bg-primary/10 ml-8'
                        )}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">
                            {msg.role === 'assistant' ? 'AI' : '用户'}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {format(new Date(msg.created_at), 'HH:mm', { locale: zhCN })}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    ))}
                  </div>
                ))}
              {messages.length === 0 && (
                <p className="text-center text-muted-foreground text-xs py-8">
                  暂无对话记录
                </p>
              )}
            </div>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  )
}
