'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CircleAlert, FileText, Loader2, RotateCcw, Save, X } from 'lucide-react'
import { toast } from 'sonner'
import type {
  MediaAsset,
  MeetingAnalysisReviewData,
  MeetingInsightReviewStatus,
} from '@/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MeetingAudioPlayer } from '@/components/meeting/meeting-audio-player'
import { CreateRequirementChangeSetButton } from '@/components/meeting/create-requirement-change-set-button'
import { EvidenceSheet } from '@/components/meeting/evidence-sheet'
import {
  reviewActionState,
  updateMeetingInsightReviewState,
  type ReviewAction,
} from '@/lib/meetings/review-state'
import { cn } from '@/lib/utils'

const categoryLabels = {
  requirement: '需求',
  decision: '决策',
  action_item: '行动项',
  risk: '风险',
  conflict: '冲突',
  open_question: '未决问题',
  out_of_scope: '范围外事项',
} as const

async function responseJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body
      && typeof body.error === 'string' ? body.error : '请求失败，请重试'
    const error = new Error(message)
    Object.assign(error, { status: response.status })
    throw error
  }
  return body as T
}

export function MeetingInsightReview({
  projectId,
  meetingId,
  audioAsset,
  initialReview,
}: {
  projectId: string
  meetingId: string
  audioAsset?: Pick<MediaAsset, 'id' | 'mime_type'>
  initialReview: MeetingAnalysisReviewData
}) {
  const router = useRouter()
  const updatedAtRef = useRef(initialReview.version.updated_at)
  const [review, setReview] = useState(initialReview)
  const [dirtyItemIds, setDirtyItemIds] = useState<Set<string>>(() => new Set())
  const [pendingActions, setPendingActions] = useState<Map<string, ReviewAction>>(() => new Map())
  const pendingItemIdsRef = useRef<Set<string>>(new Set())
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const mutationPendingRef = useRef(false)
  const [conflict, setConflict] = useState(false)
  const [approving, setApproving] = useState(false)
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null)
  const [evidenceItemId, setEvidenceItemId] = useState<string | null>(null)
  const [seekToMs, setSeekToMs] = useState<number | null>(null)
  const [seekRequestKey, setSeekRequestKey] = useState(0)
  const editable = review.version.status === 'in_review' && !conflict

  function updateItem(
    itemId: string,
    patch: Partial<Pick<MeetingAnalysisReviewData['items'][number], 'title' | 'description' | 'review_status'>>,
  ) {
    setReview((current) => ({
      ...current,
      items: current.items.map((item) => item.id === itemId ? { ...item, ...patch } : item),
    }))
    setDirtyItemIds((current) => {
      const next = new Set(current)
      next.add(itemId)
      return next
    })
  }

  function enqueueSaveItem(itemId: string, nextStatus?: MeetingInsightReviewStatus) {
    const item = review.items.find((candidate) => candidate.id === itemId)
    if (!item || !editable || pendingItemIdsRef.current.has(itemId)) return

    const action: ReviewAction = nextStatus === 'accepted'
      ? 'accept'
      : nextStatus === 'excluded'
        ? 'exclude'
        : 'save'
    const previousStatus = item.review_status
    const requestedStatus = nextStatus ?? item.review_status
    pendingItemIdsRef.current.add(itemId)
    setPendingActions((current) => new Map(current).set(itemId, action))
    if (nextStatus) {
      setReview((current) => updateMeetingInsightReviewState(
        current,
        item.id,
        requestedStatus,
      ))
    }

    saveQueueRef.current = saveQueueRef.current
      .then(async () => {
        mutationPendingRef.current = true
        try {
          const response = await fetch(`/api/meeting-analysis-items/${item.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId,
              meetingId,
              analysisVersionId: review.version.id,
              expectedUpdatedAt: updatedAtRef.current,
              title: item.title,
              description: item.description,
              reviewStatus: requestedStatus,
            }),
          })
          const data = await responseJson<{
            itemId: string
            reviewStatus: MeetingInsightReviewStatus
            updatedAt: string
          }>(response)
          updatedAtRef.current = data.updatedAt
          setReview((current) => updateMeetingInsightReviewState(
            current,
            data.itemId,
            data.reviewStatus,
            data.updatedAt,
          ))
          setDirtyItemIds((current) => {
            const next = new Set(current)
            next.delete(item.id)
            return next
          })
          toast.success(data.reviewStatus === 'accepted' ? '已接受洞察' : data.reviewStatus === 'excluded' ? '已排除洞察' : '洞察已保存')
        } catch (error) {
          if (nextStatus) {
            setReview((current) => updateMeetingInsightReviewState(
              current,
              item.id,
              previousStatus,
            ))
          }
          if (error && typeof error === 'object' && 'status' in error && error.status === 409) {
            setConflict(true)
          }
          toast.error(error instanceof Error ? error.message : '保存洞察失败')
        } finally {
          mutationPendingRef.current = false
          pendingItemIdsRef.current.delete(item.id)
          setPendingActions((current) => {
            const next = new Map(current)
            next.delete(item.id)
            return next
          })
        }
      })
      .catch((error) => {
        console.error('会议事实保存队列异常:', error)
      })
  }

  async function approveVersion() {
    if (mutationPendingRef.current || acceptedCount === 0) return
    mutationPendingRef.current = true
    setApproving(true)
    let analysisApproved = false
    try {
      const approveResponse = await fetch(`/api/meeting-analysis-versions/${review.version.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          meetingId,
          expectedUpdatedAt: updatedAtRef.current,
        }),
      })
      if (!approveResponse.ok) await responseJson(approveResponse)
      analysisApproved = true
      setReview((current) => ({
        ...current,
        version: { ...current.version, status: 'approved' },
      }))

      const changeSetResponse = await fetch(`/api/meetings/${meetingId}/requirement-change-set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, analysisVersionId: review.version.id }),
      })
      const changeSet = await responseJson<{ changeSetId: string }>(changeSetResponse)
      toast.success('会议事实已确认', { description: '请继续确认本次会议如何更新项目需求。' })
      router.push(`/projects/${projectId}/meetings/${meetingId}/requirement-changes/${changeSet.changeSetId}`)
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 409) {
        setConflict(true)
      }
      if (analysisApproved) {
        toast.warning('会议事实已确认', {
          description: error instanceof Error
            ? `需求更新步骤暂未创建：${error.message}`
            : '需求更新步骤暂未创建，请使用下方按钮继续。',
        })
        router.refresh()
      } else {
        toast.error(error instanceof Error ? error.message : '确认会议事实失败')
      }
    } finally {
      mutationPendingRef.current = false
      setApproving(false)
    }
  }

  const pendingCount = review.items.filter((item) => item.review_status === 'pending').length
  const acceptedCount = review.items.filter((item) => item.review_status === 'accepted').length

  return (
    <div className="space-y-6">
      {conflict ? (
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" />
          <AlertTitle>检测到并发修改</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>其他页面已更新该分析版本。为避免覆盖，本页面已停止保存，请刷新后继续。</p>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              <RotateCcw />重新加载远端版本
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>确认会议提炼结果</CardTitle>
              <CardDescription>
                提炼版本 V{review.version.revision_no} · {review.items.length} 项会议事实 · {pendingCount} 项待确认
              </CardDescription>
            </div>
            <Badge variant={review.version.status === 'approved' ? 'default' : 'secondary'}>
              {review.version.status === 'approved' ? '事实已确认' : '待确认'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-6 text-muted-foreground">{review.version.summary}</p>
          <div className="sticky top-4 z-10 rounded-lg border bg-background/95 p-4 shadow-sm backdrop-blur">
            {audioAsset ? (
              <MeetingAudioPlayer
                projectId={projectId}
                meetingId={meetingId}
                audioAsset={audioAsset}
                highlightedSegmentId={activeSegmentId}
                seekToMs={seekToMs}
                seekRequestKey={seekRequestKey}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                原始音频已按保留策略清理，仍可查看洞察及其转写证据。
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {review.items.map((item) => {
          const actionState = reviewActionState(
            item.review_status,
            dirtyItemIds.has(item.id),
          )
          const itemPendingAction = pendingActions.get(item.id) ?? null
          const itemPending = itemPendingAction !== null

          return (
            <Card key={item.id} className={cn(item.review_status === 'excluded' && 'opacity-60')}>
              <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{categoryLabels[item.category]}</Badge>
                  <Badge variant={item.review_status === 'accepted' ? 'default' : 'secondary'}>
                    {item.review_status === 'accepted' ? '已接受' : item.review_status === 'excluded' ? '已排除' : '待确认'}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">证据 {item.evidence.length} 条</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor={`title-${item.id}`}>标题</Label>
                <Input
                  id={`title-${item.id}`}
                  value={item.title}
                  maxLength={200}
                  disabled={!editable}
                  onChange={(event) => updateItem(item.id, { title: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`description-${item.id}`}>内容</Label>
                <Textarea
                  id={`description-${item.id}`}
                  value={item.description}
                  rows={3}
                  maxLength={4_000}
                  disabled={!editable}
                  onChange={(event) => updateItem(item.id, { description: event.target.value })}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label>原文证据</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setEvidenceItemId(item.id)}
                >
                  <FileText className="h-3.5 w-3.5" />
                  查看 {item.evidence.length} 条证据
                </Button>
              </div>
              {editable ? (
                <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={itemPending || approving || actionState.saveDisabled}
                    onClick={() => enqueueSaveItem(item.id)}
                  >
                    {itemPendingAction === 'save' ? <Loader2 className="animate-spin" /> : <Save />}
                    保存编辑
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={itemPending || approving || actionState.excludeDisabled}
                    aria-pressed={item.review_status === 'excluded'}
                    onClick={() => enqueueSaveItem(item.id, 'excluded')}
                  >
                    {itemPendingAction === 'exclude' ? <Loader2 className="animate-spin" /> : <X />}
                    {actionState.excludeLabel}
                  </Button>
                  <Button
                    type="button"
                    variant={item.review_status === 'accepted' ? 'secondary' : 'default'}
                    disabled={itemPending || approving || actionState.acceptDisabled}
                    aria-pressed={item.review_status === 'accepted'}
                    onClick={() => enqueueSaveItem(item.id, 'accepted')}
                  >
                    {itemPendingAction === 'accept' ? <Loader2 className="animate-spin" /> : <Check />}
                    {actionState.acceptLabel}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
          )
        })}
      </div>

      {review.version.status === 'in_review' ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <p className="text-sm text-muted-foreground">
              已接受 {acceptedCount} 项；{pendingCount > 0
                ? `仍有 ${pendingCount} 项待确认`
                : acceptedCount === 0
                  ? '至少需要保留一项会议事实才能继续更新项目需求'
                  : '所有会议事实均已处理'}。
            </p>
            <Button
              type="button"
              disabled={pendingCount > 0 || acceptedCount === 0 || approving || pendingActions.size > 0 || conflict}
              onClick={() => void approveVersion()}
            >
              {approving ? <Loader2 className="animate-spin" /> : <Check />}
              确认会议事实并继续
            </Button>
          </CardContent>
        </Card>
      ) : acceptedCount > 0 ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <p className="text-sm text-muted-foreground">
              会议事实已经确认。请继续决定哪些内容需要更新到项目需求中，系统已经给出可调整的建议。
            </p>
            <CreateRequirementChangeSetButton
              projectId={projectId}
              meetingId={meetingId}
              analysisVersionId={review.version.id}
            />
          </CardContent>
        </Card>
      ) : (
        <Alert>
          <CircleAlert className="h-4 w-4" />
          <AlertTitle>没有可用于更新项目需求的会议事实</AlertTitle>
          <AlertDescription>
            此提炼版本没有已接受的会议事实，因此不会修改当前正式需求。
          </AlertDescription>
        </Alert>
      )}

      <EvidenceSheet
        item={review.items.find((item) => item.id === evidenceItemId) ?? null}
        open={evidenceItemId !== null}
        activeSegmentId={activeSegmentId}
        onOpenChange={(open) => { if (!open) setEvidenceItemId(null) }}
        onSeek={(segmentId, startMs) => {
          setActiveSegmentId(segmentId)
          setSeekToMs(startMs)
          setSeekRequestKey((current) => current + 1)
        }}
      />
    </div>
  )
}
