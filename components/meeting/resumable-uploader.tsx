'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, FileAudio, Pause, Play, UploadCloud } from 'lucide-react'
import { createClient, getBrowserSupabaseConfig } from '@/lib/supabase/client'
import { formatFileSize, validateMeetingAudioFile } from '@/lib/storage/meeting-audio'
import { sha256File } from '@/lib/storage/incremental-sha256'
import {
  createMeetingAudioUpload,
  type ResumableUploadController,
  type ResumableUploadTarget,
} from '@/lib/storage/resumable-upload'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'

interface ExistingUploadTarget extends ResumableUploadTarget {
  mediaAssetId: string
  originalFilename: string
  mimeType: string | null
}

type UploadPhase = 'idle' | 'hashing' | 'uploading' | 'paused' | 'finalizing' | 'completed' | 'error'

async function readJson<T extends object>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as T | { error?: string } | null
  if (!response.ok) {
    throw new Error(body && 'error' in body && body.error ? body.error : '请求失败，请重试')
  }
  return body as T
}

export function ResumableMeetingAudioUploader({
  projectId,
  meetingId,
  existingTarget,
}: {
  projectId: string
  meetingId: string
  existingTarget?: ExistingUploadTarget
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const controllerRef = useRef<ResumableUploadController | null>(null)
  const targetRef = useRef<ExistingUploadTarget | null>(existingTarget ?? null)
  const hashAbortRef = useRef<AbortController | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<UploadPhase>('idle')
  const [progress, setProgress] = useState(0)
  const [progressBytes, setProgressBytes] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const busy = phase === 'hashing' || phase === 'uploading' || phase === 'finalizing'

  async function initializeTarget(selectedFile: File, mimeType: string) {
    const initializedTarget = targetRef.current
    if (initializedTarget) {
      if (selectedFile.name !== initializedTarget.originalFilename) {
        throw new Error(`请选择原文件“${initializedTarget.originalFilename}”以恢复上传`)
      }
      if (initializedTarget.mimeType && mimeType !== initializedTarget.mimeType) {
        throw new Error('所选文件格式与待恢复上传不一致')
      }
      return initializedTarget
    }

    const response = await fetch('/api/meetings/audio-uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        meetingId,
        originalFilename: selectedFile.name,
        mimeType,
      }),
    })
    const target = await readJson<{
      mediaAssetId: string
      bucket: string
      objectPath: string
    }>(response)
    targetRef.current = {
      ...target,
      originalFilename: selectedFile.name,
      mimeType,
    }
    return targetRef.current
  }

  async function completeUpload(
    target: { mediaAssetId: string },
    selectedFile: File,
    mimeType: string,
    sha256: string,
  ) {
    setPhase('finalizing')
    const response = await fetch(`/api/media-assets/${target.mediaAssetId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        meetingId,
        sizeBytes: selectedFile.size,
        mimeType,
        sha256,
      }),
    })
    const result = await readJson<{
      processingJobId: string
      backgroundRunId?: string
      dispatchStatus?: string
      error?: string
    }>(response)
    setPhase('completed')
    setProgress(100)
    if (!result.backgroundRunId) {
      setError(result.error || '音频已上传，但会议记录任务暂未启动，请从处理状态重新提交。')
    }
    router.refresh()
  }

  async function startUpload() {
    const selectedFile = file
    if (!selectedFile) return

    setError(null)
    setProgress(0)
    setProgressBytes(0)

    try {
      const { mimeType } = validateMeetingAudioFile(selectedFile)
      setPhase('hashing')
      const hashAbortController = new AbortController()
      hashAbortRef.current = hashAbortController
      const sha256 = await sha256File(selectedFile, {
        signal: hashAbortController.signal,
        onProgress: (bytesHashed, bytesTotal) => {
          setProgressBytes(bytesHashed)
          setProgress(bytesTotal > 0 ? (bytesHashed / bytesTotal) * 100 : 0)
        },
      })
      hashAbortRef.current = null

      const hadInitializedTarget = targetRef.current !== null
      const target = await initializeTarget(selectedFile, mimeType)
      const supabase = createClient()

      if (hadInitializedTarget) {
        const { data: existingObject } = await supabase.storage
          .from(target.bucket)
          .info(target.objectPath)
        if (existingObject) {
          await completeUpload(target, selectedFile, mimeType, sha256)
          return
        }
      }

      const supabaseConfig = getBrowserSupabaseConfig()
      const controller = createMeetingAudioUpload({
        supabase,
        supabaseUrl: supabaseConfig.url,
        supabaseAnonKey: supabaseConfig.anonKey,
        file: selectedFile,
        target,
        mimeType,
        onProgress: ({ bytesUploaded, bytesTotal }) => {
          setProgressBytes(bytesUploaded)
          setProgress(bytesTotal > 0 ? (bytesUploaded / bytesTotal) * 100 : 0)
        },
        onError: (uploadError) => {
          setError(uploadError.message || '上传失败，请重试')
          setPhase('error')
        },
        onSuccess: () => {
          void completeUpload(target, selectedFile, mimeType, sha256).catch((completeError) => {
            setError(completeError instanceof Error ? completeError.message : '上传校验失败，请重试')
            setPhase('error')
          })
        },
      })
      controllerRef.current = controller
      setPhase('uploading')
      await controller.start()
    } catch (uploadError) {
      hashAbortRef.current = null
      if (uploadError instanceof DOMException && uploadError.name === 'AbortError') {
        setPhase('idle')
        return
      }
      setError(uploadError instanceof Error ? uploadError.message : '上传失败，请重试')
      setPhase('error')
    }
  }

  async function pauseUpload() {
    const controller = controllerRef.current
    if (!controller || phase !== 'uploading') return
    await controller.pause()
    setPhase('paused')
  }

  function resumeUpload() {
    const controller = controllerRef.current
    if (!controller || phase !== 'paused') return
    setPhase('uploading')
    controller.resume()
  }

  function chooseAnotherFile() {
    hashAbortRef.current?.abort()
    controllerRef.current = null
    setFile(null)
    setError(null)
    setPhase('idle')
    setProgress(0)
    setProgressBytes(0)
    if (inputRef.current) inputRef.current.value = ''
  }

  const phaseLabel = {
    idle: '等待上传',
    hashing: '正在分块计算 SHA-256',
    uploading: '正在可恢复上传',
    paused: '上传已暂停',
    finalizing: '正在核对 Storage 对象',
    completed: '上传完成，已创建转写任务',
    error: '上传未完成',
  }[phase]

  return (
    <div className="space-y-4 rounded-md border border-dashed p-5">
      <div className="space-y-1">
        <p className="font-medium">{existingTarget ? '恢复音频上传' : '上传会议音频'}</p>
        <p className="text-sm text-muted-foreground">
          使用 6 MiB 分片上传；中断或刷新页面后，重新选择同一个文件即可续传。
        </p>
      </div>

      <Input
        ref={inputRef}
        type="file"
        accept="audio/*,video/mp4,.wav,.flac,.mp3,.ogg,.oga,.webm,.m4a,.mp4"
        disabled={busy || phase === 'paused' || phase === 'completed'}
        onChange={(event) => {
          const selectedFile = event.target.files?.[0] ?? null
          setFile(selectedFile)
          setError(null)
          setPhase('idle')
          setProgress(0)
          setProgressBytes(0)
          if (!selectedFile) return
          try {
            validateMeetingAudioFile(selectedFile)
          } catch (validationError) {
            setError(validationError instanceof Error ? validationError.message : '文件无效')
          }
        }}
      />

      {file ? (
        <div className="flex items-center gap-3 rounded-md bg-muted/50 p-3 text-sm">
          <FileAudio className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{file.name}</p>
            <p className="text-muted-foreground">{formatFileSize(file.size)}</p>
          </div>
        </div>
      ) : null}

      {phase !== 'idle' ? (
        <div className="space-y-2" aria-live="polite">
          <div className="flex justify-between gap-4 text-sm">
            <span>{phaseLabel}</span>
            <span className="text-muted-foreground">
              {formatFileSize(progressBytes)} / {file ? formatFileSize(file.size) : '0 B'}
            </span>
          </div>
          <Progress value={progress} aria-label={phaseLabel} />
          <p className="text-right text-xs text-muted-foreground">{progress.toFixed(1)}%</p>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>无法完成上传</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {phase === 'completed' ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>上传已完成</AlertTitle>
          <AlertDescription>音频已通过对象元数据校验，转写任务已经进入队列。</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {phase === 'paused' ? (
          <Button type="button" onClick={resumeUpload}>
            <Play />
            继续上传
          </Button>
        ) : phase === 'uploading' ? (
          <Button type="button" variant="outline" onClick={() => void pauseUpload()}>
            <Pause />
            暂停
          </Button>
        ) : phase !== 'completed' ? (
          <Button type="button" disabled={!file || Boolean(error && phase === 'idle') || busy} onClick={() => void startUpload()}>
            <UploadCloud />
            {phase === 'error' ? '重试' : '开始上传'}
          </Button>
        ) : null}
        {file && !busy ? (
          <Button type="button" variant="ghost" onClick={chooseAnotherFile}>
            重新选择
          </Button>
        ) : null}
      </div>
    </div>
  )
}
