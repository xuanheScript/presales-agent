'use client'

import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ElicitationSession, ElicitationCollectedInfo } from '@/types'
import { getCollectedFieldsCount } from '@/lib/ai/elicitation/progress'

interface SessionHistoryProps {
  sessions: ElicitationSession[]
  onSelectSession?: (sessionId: string) => void
  selectedSessionId?: string
  className?: string
}

const statusLabels: Record<ElicitationSession['status'], string> = {
  active: '进行中',
  completed: '已完成',
  cancelled: '已取消',
}

const statusColors: Record<ElicitationSession['status'], string> = {
  active: 'bg-blue-500',
  completed: 'bg-green-500',
  cancelled: 'bg-gray-500',
}

export function SessionHistory({
  sessions,
  onSelectSession,
  selectedSessionId,
  className,
}: SessionHistoryProps) {
  if (sessions.length === 0) {
    return (
      <Card className={cn('w-full', className)}>
        <CardHeader>
          <CardTitle className="text-sm font-medium">引导历史</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            暂无引导记录
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">
          引导历史 ({sessions.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[300px]">
          <div className="space-y-1 p-4 pt-0">
            {sessions.map((session) => {
              const collectedInfo = (session.collected_info || {}) as ElicitationCollectedInfo
              const { filled, total } = getCollectedFieldsCount(collectedInfo)

              return (
                <button
                  key={session.id}
                  className={cn(
                    'w-full text-left p-3 rounded-lg transition-colors',
                    'hover:bg-muted/50',
                    selectedSessionId === session.id && 'bg-muted',
                    !onSelectSession && 'cursor-default'
                  )}
                  onClick={() => onSelectSession?.(session.id)}
                  disabled={!onSelectSession}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="secondary"
                          className={cn(
                            'text-[10px] px-1.5 py-0 text-white',
                            statusColors[session.status]
                          )}
                        >
                          {statusLabels[session.status]}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {filled.length}/{total} 项
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {collectedInfo.projectType || collectedInfo.projectSummary || '未定义项目类型'}
                      </p>
                    </div>
                    <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(session.created_at), {
                        addSuffix: true,
                        locale: zhCN,
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                    <span>轮次: {session.current_round}/{session.max_rounds}</span>
                    {collectedInfo.keyFeatures && (
                      <span>功能: {collectedInfo.keyFeatures.length}项</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
