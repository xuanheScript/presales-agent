'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronDown,
  Check,
  CircleAlert,
  CircleOff,
  FileCheck2,
  Loader2,
  RotateCcw,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  RequirementChangeOperation,
  RequirementChangeSetReviewData,
  RequirementChangeTarget,
} from '@/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  dispositionLabels,
  mappingStatusLabels,
  projectionApplyState,
  projectionOperations,
  requiresTargetEntry,
} from '@/lib/meetings/change-projection-state'
import { cn } from '@/lib/utils'

const operationLabels: Record<RequirementChangeOperation, string> = {
  add: '新增',
  replace: '替换',
  remove: '移除',
  note: '记录事项',
}

const targetLabels: Record<RequirementChangeTarget, string> = {
  requirements: '需求正文',
  business_goals: '业务目标',
  key_features: '关键功能',
  tech_stack: '技术栈',
  non_functional_requirements: '非功能需求',
  risks: '风险',
  decisions: '决策',
  action_items: '行动项',
  conflicts: '冲突',
  open_questions: '未决问题',
  out_of_scope: '范围外事项',
}

const categoryLabels = {
  requirement: '需求',
  decision: '决策',
  action_item: '行动项',
  risk: '风险',
  conflict: '冲突',
  open_question: '未决问题',
  out_of_scope: '范围外事项',
} as const

type ChangeItem = RequirementChangeSetReviewData['items'][number]
type PendingProjectionAction = 'include' | 'omit'

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

function copyItem(item: ChangeItem): ChangeItem {
  return { ...item }
}

export function RequirementChangeSetReview({
  projectId,
  initialReview,
}: {
  projectId: string
  initialReview: RequirementChangeSetReviewData
}) {
  const router = useRouter()
  const updatedAtRef = useRef(initialReview.changeSet.updated_at)
  const confirmedItemsRef = useRef(new Map(
    initialReview.items.map((item) => [item.id, copyItem(item)]),
  ))
  const pendingItemIdsRef = useRef<Set<string>>(new Set())
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const mutationPendingRef = useRef(false)
  const applyingRef = useRef(false)
  const conflictRef = useRef(false)
  const [review, setReview] = useState(initialReview)
  const [pendingActions, setPendingActions] = useState<Map<string, PendingProjectionAction>>(
    () => new Map(),
  )
  const [dirtyItemIds, setDirtyItemIds] = useState<Set<string>>(() => new Set())
  const [openItemIds, setOpenItemIds] = useState<Set<string>>(() => new Set(
    initialReview.items
      .filter((item) => item.mapping_status === 'decision_required')
      .map((item) => item.id),
  ))
  const [applying, setApplying] = useState(false)
  const [conflict, setConflict] = useState(false)
  const editable = review.changeSet.status === 'in_review' && !conflict
  const isBootstrap = review.changeSet.base_baseline_id === null
  const availableOperations = projectionOperations(isBootstrap)

  function availableTargetEntries(item: ChangeItem) {
    return review.changeSet.base_snapshot.sections[item.target_path]
  }

  function updateItem(itemId: string, patch: Partial<ChangeItem>) {
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

  function setItemOpen(itemId: string, open: boolean) {
    setOpenItemIds((current) => {
      const next = new Set(current)
      if (open) next.add(itemId)
      else next.delete(itemId)
      return next
    })
  }

  function rollbackItem(itemId: string) {
    const confirmedItem = confirmedItemsRef.current.get(itemId)
    if (!confirmedItem) return

    setReview((current) => ({
      ...current,
      items: current.items.map((item) => item.id === itemId ? copyItem(confirmedItem) : item),
    }))
    setDirtyItemIds((current) => {
      const next = new Set(current)
      next.delete(itemId)
      return next
    })
  }

  function enqueueSaveItem(itemId: string) {
    const item = review.items.find((candidate) => candidate.id === itemId)
    if (!item || !editable || applyingRef.current || pendingItemIdsRef.current.has(itemId)) return

    if (requiresTargetEntry(item.disposition, item.operation) && !item.target_entry_id) {
      toast.error('请先选择要替换或移除的现有需求条目')
      return
    }

    const requestedItem = copyItem(item)
    if (requestedItem.disposition === 'omit') requestedItem.target_entry_id = null
    const pendingAction: PendingProjectionAction = item.disposition
    pendingItemIdsRef.current.add(itemId)
    setPendingActions((current) => new Map(current).set(itemId, pendingAction))
    setReview((current) => ({
      ...current,
      items: current.items.map((candidate) => candidate.id === itemId
        ? { ...candidate, mapping_status: 'ready' }
        : candidate),
    }))

    saveQueueRef.current = saveQueueRef.current
      .then(async () => {
        mutationPendingRef.current = true
        try {
          if (conflictRef.current) throw new Error('页面存在版本冲突，请重新加载后继续')

          const response = await fetch(`/api/requirement-change-items/${requestedItem.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId,
              changeSetId: review.changeSet.id,
              expectedUpdatedAt: updatedAtRef.current,
              operation: requestedItem.operation,
              targetPath: requestedItem.target_path,
              targetEntryId: requestedItem.target_entry_id,
              title: requestedItem.title,
              content: requestedItem.content,
              disposition: requestedItem.disposition,
            }),
          })
          const data = await responseJson<{ updatedAt: string }>(response)
          const savedItem: ChangeItem = {
            ...requestedItem,
            mapping_status: 'ready',
            mapping_reason: '人工确认需求更新方式',
            review_status: requestedItem.disposition === 'include' ? 'accepted' : 'excluded',
            updated_at: data.updatedAt,
          }
          updatedAtRef.current = data.updatedAt
          confirmedItemsRef.current.set(itemId, copyItem(savedItem))
          setReview((current) => ({
            changeSet: { ...current.changeSet, updated_at: data.updatedAt },
            items: current.items.map((candidate) => candidate.id === itemId
              ? savedItem
              : candidate),
          }))
          setDirtyItemIds((current) => {
            const next = new Set(current)
            next.delete(itemId)
            return next
          })
          toast.success(requestedItem.disposition === 'include'
            ? '需求更新方式已确认'
            : '已确认本次不更新项目需求')
        } catch (error) {
          rollbackItem(itemId)
          if (error && typeof error === 'object' && 'status' in error && error.status === 409) {
            conflictRef.current = true
            setConflict(true)
          }
          toast.error(error instanceof Error ? error.message : '保存需求更新方式失败')
        } finally {
          mutationPendingRef.current = false
          pendingItemIdsRef.current.delete(itemId)
          setPendingActions((current) => {
            const next = new Map(current)
            next.delete(itemId)
            return next
          })
        }
      })
      .catch((error) => {
        console.error('需求更新保存队列异常:', error)
      })
  }

  async function applyChangeSet() {
    const currentApplyState = projectionApplyState({
      items: review.items,
      dirtyCount: dirtyItemIds.size,
      pendingRequestCount: pendingItemIdsRef.current.size,
      conflict: conflictRef.current,
    })
    if (!editable || applyingRef.current || mutationPendingRef.current || !currentApplyState.canApply) return

    applyingRef.current = true
    mutationPendingRef.current = true
    setApplying(true)
    try {
      const response = await fetch(`/api/requirement-change-sets/${review.changeSet.id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          expectedUpdatedAt: updatedAtRef.current,
        }),
      })
      const data = await responseJson<{ baselineId: string }>(response)
      setReview((current) => ({
        ...current,
        changeSet: {
          ...current.changeSet,
          status: 'applied',
          resulting_baseline_id: data.baselineId,
        },
      }))
      toast.success(isBootstrap ? '正式需求已创建' : '项目需求已更新', {
        description: '新的正式需求版本已生效，旧版本仍保留用于审计。',
      })
      router.refresh()
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 409) {
        conflictRef.current = true
        setConflict(true)
      }
      toast.error(error instanceof Error ? error.message : '更新项目需求失败')
    } finally {
      applyingRef.current = false
      mutationPendingRef.current = false
      setApplying(false)
    }
  }

  const dirtyCount = dirtyItemIds.size
  const applyState = projectionApplyState({
    items: review.items,
    dirtyCount,
    pendingRequestCount: pendingActions.size,
    conflict,
  })

  return (
    <div className="space-y-6">
      {conflict ? (
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" />
          <AlertTitle>检测到并发修改</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>项目正式需求或本次更新内容已发生变化。为避免覆盖，本页面已停止保存。</p>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              <RotateCcw />重新加载远端版本
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>确认如何更新项目需求</CardTitle>
                <Badge variant="outline">{isBootstrap ? '创建正式需求' : '更新正式需求'}</Badge>
              </div>
              <CardDescription>
                已确认的会议事实不会在这里被修改。系统已为 {review.items.length} 项事实建议更新方式；
                {applyState.decisionRequiredCount > 0
                  ? `请重点确认其中 ${applyState.decisionRequiredCount} 项。`
                  : '当前建议均可直接应用，也可以展开调整。'}
              </CardDescription>
            </div>
            <Badge variant={review.changeSet.status === 'applied' ? 'default' : 'secondary'}>
              {review.changeSet.status === 'applied'
                ? '需求已更新'
                : review.changeSet.status === 'superseded'
                  ? '需要重新确认'
                  : '待确认'}
            </Badge>
          </div>
        </CardHeader>
      </Card>

      <div className="space-y-4">
        {review.items.map((item) => {
          const itemPendingAction = pendingActions.get(item.id) ?? null
          const itemPending = itemPendingAction !== null
          const itemDirty = dirtyItemIds.has(item.id)
          const targetMissing = requiresTargetEntry(item.disposition, item.operation)
            && !item.target_entry_id
          const controlsDisabled = !editable || applying || itemPending
          const sourceDiffers = item.title !== item.source_title || item.content !== item.source_content
          const itemOpen = openItemIds.has(item.id)

          return (
            <Collapsible
              key={item.id}
              open={itemOpen}
              onOpenChange={(open) => setItemOpen(item.id, open)}
              asChild
            >
              <Card className={cn(item.disposition === 'omit' && 'border-dashed')}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{categoryLabels[item.category]}</Badge>
                      <Badge variant={item.mapping_status === 'ready' ? 'default' : 'secondary'}>
                        {mappingStatusLabels[item.mapping_status]}
                      </Badge>
                      <Badge variant={item.disposition === 'include' ? 'secondary' : 'outline'}>
                        {dispositionLabels[item.disposition]}
                      </Badge>
                      {itemDirty ? <Badge variant="outline">有未保存调整</Badge> : null}
                    </div>
                    <span className="text-xs text-muted-foreground">会议事实 #{item.sequence_no + 1}</span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium leading-6">{item.source_title}</p>
                      <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{item.source_content}</p>
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button type="button" size="sm" variant="ghost" className="shrink-0">
                        {itemOpen ? '收起详情' : item.mapping_status === 'decision_required' ? '确认此项' : '查看或调整'}
                        <ChevronDown className={cn('transition-transform', itemOpen && 'rotate-180')} />
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  {item.mapping_reason ? (
                    <CardDescription className="leading-5">
                      系统建议：{item.mapping_reason}
                    </CardDescription>
                  ) : null}
                </CardHeader>
                <CollapsibleContent>
                  <CardContent className="space-y-5">
                    <section className="rounded-lg border bg-muted/35 p-4" aria-labelledby={`source-fact-${item.id}`}>
                  <div className="mb-3 flex items-center gap-2">
                    <FileCheck2 className="h-4 w-4 text-muted-foreground" />
                    <h3 id={`source-fact-${item.id}`} className="text-sm font-medium">已确认会议事实</h3>
                    <Badge variant="outline" className="ml-auto">只读</Badge>
                  </div>
                  <p className="font-medium leading-6">{item.source_title}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {item.source_content}
                  </p>
                </section>

                <section className="space-y-4 border-l-2 border-primary/20 pl-4" aria-labelledby={`projection-${item.id}`}>
                  <div>
                    <h3 id={`projection-${item.id}`} className="text-sm font-medium">更新项目需求</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      可调整更新位置和写入内容。即使修改了表述，系统仍会保留原始会议事实作为来源证据。
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>写入决定</Label>
                    <div className="flex flex-wrap gap-2" role="group" aria-label="选择该事实是否更新项目需求">
                      <Button
                        type="button"
                        size="sm"
                        variant={item.disposition === 'include' ? 'default' : 'outline'}
                        disabled={controlsDisabled}
                        aria-pressed={item.disposition === 'include'}
                        onClick={() => updateItem(item.id, { disposition: 'include' })}
                      >
                        <Check />更新项目需求
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={item.disposition === 'omit' ? 'secondary' : 'outline'}
                        disabled={controlsDisabled}
                        aria-pressed={item.disposition === 'omit'}
                        onClick={() => updateItem(item.id, { disposition: 'omit' })}
                      >
                        <CircleOff />本次不更新
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`change-operation-${item.id}`}>更新方式</Label>
                      <Select
                        value={item.operation}
                        disabled={controlsDisabled}
                        onValueChange={(value: RequirementChangeOperation) => updateItem(item.id, {
                          operation: value,
                          target_entry_id: value === 'replace' || value === 'remove'
                            ? item.target_entry_id
                            : null,
                        })}
                      >
                        <SelectTrigger id={`change-operation-${item.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {availableOperations.map((value) => (
                            <SelectItem key={value} value={value}>{operationLabels[value]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`change-target-${item.id}`}>目标区域</Label>
                      <Select
                        value={item.target_path}
                        disabled={controlsDisabled}
                        onValueChange={(value: RequirementChangeTarget) => updateItem(item.id, {
                          target_path: value,
                          target_entry_id: null,
                        })}
                      >
                        <SelectTrigger id={`change-target-${item.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(targetLabels).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {!isBootstrap && (item.operation === 'replace' || item.operation === 'remove') ? (
                    <div className="space-y-1.5">
                      <Label htmlFor={`change-target-entry-${item.id}`}>
                        目标条目{item.disposition === 'include' ? '（必选）' : '（本次不更新时可留空）'}
                      </Label>
                      <Select
                        value={item.target_entry_id ?? undefined}
                        disabled={controlsDisabled}
                        onValueChange={(value) => updateItem(item.id, { target_entry_id: value })}
                      >
                        <SelectTrigger id={`change-target-entry-${item.id}`}>
                          <SelectValue placeholder="选择要替换或移除的条目" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableTargetEntries(item).map((entry) => (
                            <SelectItem key={entry.id} value={entry.id}>{entry.title}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {item.disposition === 'include' && availableTargetEntries(item).length === 0 ? (
                        <p className="text-xs text-destructive">
                          现有需求中没有可替换或移除的条目，请改为新增、记录事项，或选择本次不更新。
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="space-y-1.5">
                    <Label htmlFor={`change-title-${item.id}`}>需求标题</Label>
                    <Input
                      id={`change-title-${item.id}`}
                      value={item.title}
                      maxLength={200}
                      disabled={controlsDisabled}
                      onChange={(event) => updateItem(item.id, { title: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`change-content-${item.id}`}>需求内容</Label>
                    <Textarea
                      id={`change-content-${item.id}`}
                      value={item.content}
                      rows={4}
                      maxLength={4_000}
                      disabled={controlsDisabled}
                      onChange={(event) => updateItem(item.id, { content: event.target.value })}
                    />
                  </div>
                  {sourceDiffers ? (
                    <p className="text-xs leading-5 text-muted-foreground">
                      当前需求表述与会议事实不同；正式版本会同时保留原始事实和更新后的表述。
                    </p>
                  ) : null}
                </section>

                {editable ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                    <p className="text-xs text-muted-foreground">
                      {item.mapping_status === 'decision_required'
                        ? '此项需要确认一次更新方式后才能继续。'
                        : item.mapping_status === 'auto_mapped' && !itemDirty
                          ? '系统建议可直接应用；如需调整，请先保存。'
                          : itemDirty
                            ? '请保存当前调整。'
                            : '更新方式已保存。'}
                    </p>
                    <Button
                      type="button"
                      variant={item.disposition === 'include' ? 'default' : 'secondary'}
                      disabled={itemPending
                        || applying
                        || targetMissing
                        || (!itemDirty && item.mapping_status !== 'decision_required')}
                      onClick={() => enqueueSaveItem(item.id)}
                    >
                      {itemPending ? <Loader2 className="animate-spin" /> : item.disposition === 'include' ? <Check /> : <CircleOff />}
                      {item.disposition === 'include' ? '确认更新方式' : '确认本次不更新'}
                    </Button>
                  </div>
                ) : null}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )
        })}
      </div>

      {review.changeSet.status === 'in_review' ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>本次将使用 {applyState.includedCount} 项会议事实更新项目需求。</p>
              <p>
                {applyState.conflictingTargetCount > 0
                  ? `有 ${applyState.conflictingTargetCount} 个现有需求条目被重复替换或移除，请调整。`
                  : applyState.decisionRequiredCount > 0
                    ? `仍有 ${applyState.decisionRequiredCount} 项需要确认。`
                    : dirtyCount > 0
                      ? `仍有 ${dirtyCount} 项调整未保存。`
                      : pendingActions.size > 0
                        ? `正在保存 ${pendingActions.size} 项更新。`
                        : applyState.includedCount === 0
                          ? '至少需要选择一项会议事实才能更新正式需求。'
                          : '所有内容均已确认，可以更新正式需求。'}
              </p>
            </div>
            <Button
              type="button"
              disabled={!applyState.canApply || applying}
              onClick={() => void applyChangeSet()}
            >
              {applying ? <Loader2 className="animate-spin" /> : <Check />}
              {isBootstrap ? '创建正式需求' : '确认并更新项目需求'}
            </Button>
          </CardContent>
        </Card>
      ) : review.changeSet.status === 'applied' ? (
        <Card className="border-emerald-300 bg-emerald-50/40 dark:bg-emerald-950/10">
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                <Check className="h-4 w-4" />
              </span>
              <div>
                <p className="font-medium">项目需求已更新</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  新的正式需求版本已经生效。旧版本和本次会议证据均已保留，可以继续进行方案与成本分析。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href={`/projects/${projectId}/analysis`}>进入方案与成本分析</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/projects/${projectId}`}>返回需求工作台</Link>
              </Button>
            </div>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">技术详情</summary>
              <p className="mt-2 break-all">正式需求版本 ID：{review.changeSet.resulting_baseline_id}</p>
            </details>
          </CardContent>
        </Card>
      ) : (
        <Alert>
          <CircleAlert className="h-4 w-4" />
          <AlertTitle>本次需求更新需要重新确认</AlertTitle>
          <AlertDescription>
            项目正式需求已发生变化。请返回会议提炼结果，基于最新需求重新确认本次会议的影响。
            {review.changeSet.superseded_by_change_set_id
              ? ' 系统已保留新的待确认版本。'
              : ''}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
