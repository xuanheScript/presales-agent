'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { CircleAlert, Loader2, Play } from 'lucide-react'
import type { MediaAsset, TranscriptSegment } from '@/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export function formatMeetingTimestamp(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  return hours > 0
    ? [hours, minutes, remainingSeconds].map((part) => String(part).padStart(2, '0')).join(':')
    : [minutes, remainingSeconds].map((part) => String(part).padStart(2, '0')).join(':')
}

async function playbackResponse(response: Response): Promise<{
  signedUrl: string
  expiresIn: number
}> {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body
      && typeof body.error === 'string' ? body.error : '加载音频失败'
    throw new Error(message)
  }
  return body as { signedUrl: string; expiresIn: number }
}

export function MeetingAudioPlayer({
  projectId,
  meetingId,
  audioAsset,
  highlightedSegmentId,
  seekToMs,
  seekRequestKey,
  onTimeUpdate,
}: {
  projectId: string
  meetingId: string
  audioAsset: Pick<MediaAsset, 'id' | 'mime_type'>
  highlightedSegmentId?: string | null
  seekToMs?: number | null
  seekRequestKey?: number
  onTimeUpdate?: (currentMs: number) => void
}) {
  const mediaRef = useRef<HTMLAudioElement | HTMLVideoElement>(null)
  const resumeRef = useRef<{ currentTime: number; shouldPlay: boolean } | null>(null)
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let ignore = false
    let refreshTimer: number | undefined
    const query = new URLSearchParams({ projectId, meetingId })
    void fetch(`/api/media-assets/${audioAsset.id}/playback?${query}`, { cache: 'no-store' })
      .then(playbackResponse)
      .then((data) => {
        if (ignore) return
        setPlaybackError(null)
        setPlaybackUrl(data.signedUrl)
        refreshTimer = window.setTimeout(() => {
          const media = mediaRef.current
          if (media) {
            resumeRef.current = {
              currentTime: media.currentTime,
              shouldPlay: !media.paused,
            }
          }
          setRefreshKey((current) => current + 1)
        }, Math.max(30, data.expiresIn - 60) * 1_000)
      })
      .catch((error) => {
        if (!ignore) setPlaybackError(error instanceof Error ? error.message : '加载音频失败')
      })
    return () => {
      ignore = true
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
    }
  }, [audioAsset.id, meetingId, projectId, refreshKey])

  useEffect(() => {
    if (seekToMs == null || !mediaRef.current || !playbackUrl) return
    mediaRef.current.currentTime = seekToMs / 1_000
    void mediaRef.current.play().catch(() => undefined)
  }, [playbackUrl, seekRequestKey, seekToMs])

  function handleLoadedMetadata() {
    const media = mediaRef.current
    const resume = resumeRef.current
    if (!media || !resume) return
    media.currentTime = resume.currentTime
    resumeRef.current = null
    if (resume.shouldPlay) void media.play().catch(() => undefined)
  }

  function handleMediaError() {
    const media = mediaRef.current
    if (media) {
      resumeRef.current = {
        currentTime: media.currentTime,
        shouldPlay: !media.paused,
      }
    }
    setRefreshKey((current) => current + 1)
  }

  function handleTimeUpdate() {
    onTimeUpdate?.((mediaRef.current?.currentTime ?? 0) * 1000)
  }

  const isVideo = audioAsset.mime_type === 'video/mp4'
  const mediaProps = {
    src: playbackUrl ?? undefined,
    controls: true,
    preload: 'metadata' as const,
    onLoadedMetadata: handleLoadedMetadata,
    onError: handleMediaError,
    onTimeUpdate: handleTimeUpdate,
  }

  return (
    <div className="space-y-3">
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
            {...mediaProps}
            className="max-h-64 w-full rounded-md bg-black"
          />
        ) : (
          <audio
            ref={mediaRef as RefObject<HTMLAudioElement>}
            {...mediaProps}
            className="w-full"
          />
        )
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />正在加载安全播放地址
        </div>
      )}
      {highlightedSegmentId ? (
        <p className="text-xs text-muted-foreground">当前证据片段：{highlightedSegmentId}</p>
      ) : null}
    </div>
  )
}

export function EvidenceSeekButton({
  segment,
  onSeek,
}: {
  segment: Pick<TranscriptSegment, 'start_ms' | 'end_ms'>
  onSeek: () => void
}) {
  return (
    <Button type="button" size="sm" variant="outline" onClick={onSeek}>
      <Play className="h-3.5 w-3.5" />
      {formatMeetingTimestamp(segment.start_ms)}–{formatMeetingTimestamp(segment.end_ms)}
    </Button>
  )
}
