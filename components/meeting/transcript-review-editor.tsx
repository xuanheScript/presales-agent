'use client'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CircleAlert, Loader2, Play, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import type { MediaAsset, TranscriptReviewData, TranscriptSegment } from '@/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface EditableSegment {
  id: string
  sequenceNo: number
  speakerKey: string | null
  startMs: number
  endMs: number
  text: string
  confidence: number | null
  words: TranscriptSegment['words']
  sourceSegmentId: string | null
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'

function editableSegments(segments: TranscriptSegment[]): EditableSegment[] {
  return segments.map((segment) => ({
    id: segment.id,
    sequenceNo: segment.sequence_no,
    speakerKey: segment.speaker_key,
    startMs: segment.start_ms,
    endMs: segment.end_ms,
    text: segment.text,
    confidence: segment.confidence,
    words: segment.words,
    sourceSegmentId: segment.source_segment_id ?? segment.id,
  }))
}

function formatTimestamp(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  return hours > 0
    ? [hours, minutes, remainingSeconds].map((part) => String(part).padStart(2, '0')).join(':')
    : [minutes, remainingSeconds].map((part) => String(part).padStart(2, '0')).join(':')
}

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

export function TranscriptReviewEditor({
  projectId,
  meetingId,
  audioAsset,
  initialReview,
}: {
  projectId: string
  meetingId: string
  audioAsset: Pick<MediaAsset, 'id' | 'mime_type'>
  initialReview: TranscriptReviewData
}) {
  const router = useRouter()
  const mediaRef = useRef<HTMLAudioElement | HTMLVideoElement>(null)
  const savePromiseRef = useRef<Promise<string | null> | null>(null)
  const segmentsRef = useRef<EditableSegment[]>(editableSegments(initialReview.segments))
  const updatedAtRef = useRef(initialReview.revision.updated_at)
  const dirtyVersionRef = useRef(0)
  const [review, setReview] = useState(initialReview)
  const [segments, setSegments] = useState(segmentsRef.current)
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [activeSequence, setActiveSequence] = useState<number | null>(null)
  const saveStateRef = useRef<SaveState>('idle')
  const [saveState, setSaveStateValue] = useState<SaveState>('idle')
  const setSaveState = useCallback((state: SaveState) => {
    saveStateRef.current = state
    setSaveStateValue(state)
  }, [])
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [isCreatingDraft, setIsCreatingDraft] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const editable = review.revision.kind === 'human' && review.revision.status !== 'approved'

  useEffect(() => {
    let ignore = false
    async function loadPlaybackUrl() {
      try {
        const query = new URLSearchParams({ projectId, meetingId })
        const response = await fetch(`/api/media-assets/${audioAsset.id}/playback?${query}`, {
          cache: 'no-store',
        })
        const data = await responseJson<{ signedUrl: string }>(response)
        if (!ignore) setPlaybackUrl(data.signedUrl)
      } catch (error) {
        if (!ignore) {
          setPlaybackError(error instanceof Error ? error.message : '加载音频失败')
        }
      }
    }
    void loadPlaybackUrl()
    return () => { ignore = true }
  }, [audioAsset.id, meetingId, projectId])

  const saveDraft = useCallback(async (): Promise<string | null> => {
    if (!editable || saveStateRef.current === 'conflict') return null
    const pendingSave = savePromiseRef.current
    if (pendingSave) {
      await pendingSave
      return saveStateRef.current === 'dirty' ? saveDraft() : updatedAtRef.current
    }

    const version = dirtyVersionRef.current
    const snapshot = segmentsRef.current.map((segment) => ({
      sequenceNo: segment.sequenceNo,
      speakerKey: segment.speakerKey,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
      confidence: segment.confidence,
      words: segment.words,
      sourceSegmentId: segment.sourceSegmentId,
    }))
    setSaveState('saving')
    const request = fetch(`/api/transcript-revisions/${review.revision.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        meetingId,
        expectedUpdatedAt: updatedAtRef.current,
        segments: snapshot,
      }),
    }).then(async (response) => {
      const data = await responseJson<{ updatedAt: string }>(response)
      updatedAtRef.current = data.updatedAt
      setReview((current) => ({
        ...current,
        revision: { ...current.revision, updated_at: data.updatedAt },
      }))
      if (dirtyVersionRef.current === version) {
        setSaveState('saved')
        setSavedAt(new Date().toISOString())
      } else {
        setSaveState('dirty')
      }
      return data.updatedAt
    }).catch((error) => {
      if (error && typeof error === 'object' && 'status' in error && error.status === 409) {
        setSaveState('conflict')
      } else {
        setSaveState('error')
      }
      return null
    }).finally(() => {
      savePromiseRef.current = null
    })
    savePromiseRef.current = request
    return request
  }, [editable, meetingId, projectId, review.revision.id, setSaveState])

  useEffect(() => {
    if (saveState !== 'dirty' || !editable) return
    const timer = window.setTimeout(() => void saveDraft(), 1000)
    return () => window.clearTimeout(timer)
  }, [editable, saveDraft, saveState, segments])

  useEffect(() => {
    function warnUnsaved(event: BeforeUnloadEvent) {
      if (saveState === 'dirty' || saveState === 'saving' || saveState === 'error') {
        event.preventDefault()
      }
    }
    window.addEventListener('beforeunload', warnUnsaved)
    return () => window.removeEventListener('beforeunload', warnUnsaved)
  }, [saveState])

  function updateSegment(sequenceNo: number, patch: Partial<Pick<EditableSegment, 'speakerKey' | 'text'>>) {
    dirtyVersionRef.current += 1
    setSegments((current) => {
      const next = current.map((segment) => segment.sequenceNo === sequenceNo
        ? { ...segment, ...patch }
        : segment)
      segmentsRef.current = next
      return next
    })
    setSaveState('dirty')
  }

  function seekToSegment(segment: EditableSegment) {
    const media = mediaRef.current
    if (!media) return
    media.currentTime = segment.startMs / 1000
    setActiveSequence(segment.sequenceNo)
    void media.play()
  }

  function updateActiveSegment() {
    const currentMs = (mediaRef.current?.currentTime ?? 0) * 1000
    const active = segmentsRef.current.find((segment) =>
      currentMs >= segment.startMs && currentMs <= segment.endMs,
    )
    setActiveSequence(active?.sequenceNo ?? null)
  }

  async function createDraft() {
    setIsCreatingDraft(true)
    try {
      const response = await fetch(`/api/meetings/${meetingId}/transcript-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const draft = await responseJson<TranscriptReviewData>(response)
      const nextSegments = editableSegments(draft.segments)
      segmentsRef.current = nextSegments
      updatedAtRef.current = draft.revision.updated_at
      dirtyVersionRef.current = 0
      setReview(draft)
      setSegments(nextSegments)
      setSaveState('idle')
      toast.success('已创建人工校对草稿')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建校对草稿失败')
    } finally {
      setIsCreatingDraft(false)
    }
  }

  async function approveDraft() {
    const updatedAt = await saveDraft()
    if (!updatedAt) {
      toast.error('校对稿尚未成功保存，不能批准')
      return
    }
    setIsApproving(true)
    try {
      const response = await fetch(`/api/transcript-revisions/${review.revision.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          meetingId,
          expectedUpdatedAt: updatedAtRef.current,
        }),
      })
      const data = await responseJson<{
        transcriptApproved: boolean
        analysisStarted: boolean
        processingJobId?: string
        dispatchStatus?: string
        error?: string
      }>(response)
      setReview((current) => ({
        ...current,
        revision: { ...current.revision, status: 'approved' },
      }))
      setSaveState('saved')
      if (data.analysisStarted) {
        toast.success('会议记录已确认', { description: '系统正在自动提炼需求信息。' })
      } else {
        toast.warning('会议记录已确认', {
          description: data.error || '自动提炼暂未启动，可从处理状态恢复。',
        })
      }
      router.refresh()
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 409) {
        setSaveState('conflict')
      }
      toast.error(error instanceof Error ? error.message : '批准校对稿失败')
    } finally {
      setIsApproving(false)
    }
  }

  const isVideo = audioAsset.mime_type === 'video/mp4'
  const saveLabel = {
    idle: '尚未修改',
    dirty: '有未保存修改',
    saving: '正在保存',
    saved: savedAt ? `已保存 ${new Date(savedAt).toLocaleTimeString('zh-CN')}` : '已保存',
    error: '保存失败',
    conflict: '远端版本已更新',
  }[saveState]

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>确认会议记录</CardTitle>
            <CardDescription>
              版本 {review.revision.revision_no} · {review.revision.kind === 'machine' ? '自动记录' : '人工校对记录'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={review.revision.status === 'approved' ? 'default' : 'secondary'}>
              {review.revision.status === 'approved' ? '已批准' : editable ? saveLabel : '待创建校对稿'}
            </Badge>
            {!editable ? (
              <Button onClick={() => void createDraft()} disabled={isCreatingDraft}>
                {isCreatingDraft ? <Loader2 className="animate-spin" /> : <Save />}
                {review.revision.status === 'approved' ? '创建新校对版本' : '开始校对会议记录'}
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {saveState === 'conflict' ? (
          <Alert variant="destructive">
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>检测到并发修改</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>其他页面已经保存了这个校对稿。为避免覆盖，本页面已停止自动保存。</p>
              <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                <RotateCcw />重新加载远端版本
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="sticky top-4 z-10 rounded-lg border bg-background/95 p-4 shadow-sm backdrop-blur">
          {playbackError ? (
            <Alert variant="destructive">
              <CircleAlert className="h-4 w-4" />
              <AlertTitle>无法播放会议音频</AlertTitle>
              <AlertDescription>{playbackError}</AlertDescription>
            </Alert>
          ) : playbackUrl ? (
            isVideo ? (
              <video
                ref={mediaRef as RefObject<HTMLVideoElement>}
                src={playbackUrl}
                controls
                preload="metadata"
                className="max-h-64 w-full rounded-md bg-black"
                onTimeUpdate={updateActiveSegment}
              />
            ) : (
              <audio
                ref={mediaRef as RefObject<HTMLAudioElement>}
                src={playbackUrl}
                controls
                preload="metadata"
                className="w-full"
                onTimeUpdate={updateActiveSegment}
              />
            )
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />正在加载安全播放地址
            </div>
          )}
        </div>

        <div className="space-y-3">
          {segments.map((segment) => (
            <div
              key={segment.id}
              className={cn(
                'grid gap-3 rounded-lg border p-4 transition-colors md:grid-cols-[150px_1fr]',
                activeSequence === segment.sequenceNo && 'border-primary bg-primary/5',
              )}
            >
              <div className="space-y-3">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => seekToSegment(segment)}
                >
                  <Play className="h-3.5 w-3.5" />
                  {formatTimestamp(segment.startMs)}–{formatTimestamp(segment.endMs)}
                </Button>
                <div className="space-y-1.5">
                  <Label htmlFor={`speaker-${segment.id}`}>说话人</Label>
                  <Input
                    id={`speaker-${segment.id}`}
                    value={segment.speakerKey ?? ''}
                    disabled={!editable || saveState === 'conflict'}
                    maxLength={100}
                    onChange={(event) => updateSegment(segment.sequenceNo, {
                      speakerKey: event.target.value || null,
                    })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`text-${segment.id}`}>转写文本</Label>
                <Textarea
                  id={`text-${segment.id}`}
                  value={segment.text}
                  disabled={!editable || saveState === 'conflict'}
                  rows={3}
                  maxLength={20_000}
                  onChange={(event) => updateSegment(segment.sequenceNo, {
                    text: event.target.value,
                  })}
                />
              </div>
            </div>
          ))}
        </div>

        {editable ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className={cn(
              'text-sm text-muted-foreground',
              (saveState === 'error' || saveState === 'conflict') && 'text-destructive',
            )}>
              {saveState === 'saving' ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}
              {saveLabel} · 修改内容会自动保存
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={isApproving || saveState === 'conflict'}>
                  {isApproving ? <Loader2 className="animate-spin" /> : <Check />}
                  确认会议记录并提炼需求
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认当前会议记录？</AlertDialogTitle>
                  <AlertDialogDescription>
                    确认后当前版本将不可再编辑，并会自动开始提炼需求、决策与风险。如需再次修改，会创建新的人工校对版本。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>继续校对</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void approveDraft()}>
                    确认并开始提炼
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
