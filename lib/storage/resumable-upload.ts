'use client'

import * as tus from 'tus-js-client'
import type { SupabaseClient } from '@supabase/supabase-js'

const TUS_CHUNK_BYTES = 6 * 1024 * 1024
const RETRY_DELAYS_MS = [0, 3_000, 5_000, 10_000, 20_000]

export interface ResumableUploadTarget {
  bucket: string
  objectPath: string
}

export interface ResumableUploadProgress {
  bytesUploaded: number
  bytesTotal: number
}

export interface ResumableUploadController {
  start: () => Promise<void>
  pause: () => Promise<void>
  resume: () => void
}

export function getSupabaseTusEndpoint(supabaseUrl: string): string {
  const url = new URL(supabaseUrl)
  const hostedMatch = url.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i)
  if (hostedMatch) {
    return `https://${hostedMatch[1]}.storage.supabase.co/storage/v1/upload/resumable`
  }
  return new URL('/storage/v1/upload/resumable', url).toString()
}

export function createMeetingAudioUpload(input: {
  supabase: SupabaseClient
  supabaseUrl: string
  supabaseAnonKey: string
  file: File
  target: ResumableUploadTarget
  mimeType: string
  onProgress: (progress: ResumableUploadProgress) => void
  onError: (error: Error) => void
  onSuccess: () => void
}): ResumableUploadController {
  let initialized = false

  const upload = new tus.Upload(input.file, {
    endpoint: getSupabaseTusEndpoint(input.supabaseUrl),
    chunkSize: TUS_CHUNK_BYTES,
    retryDelays: RETRY_DELAYS_MS,
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    headers: {
      apikey: input.supabaseAnonKey,
      'x-upsert': 'false',
    },
    metadata: {
      bucketName: input.target.bucket,
      objectName: input.target.objectPath,
      contentType: input.mimeType,
      cacheControl: '3600',
    },
    fingerprint: async (file) => [
      'meeting-audio',
      input.target.bucket,
      input.target.objectPath,
      file.name,
      file.type,
      file.size,
      file.lastModified,
    ].join(':'),
    onBeforeRequest: async (request) => {
      const { data, error } = await input.supabase.auth.getSession()
      if (error || !data.session) {
        throw new Error('登录状态已失效，请重新登录后继续上传')
      }
      request.setHeader('Authorization', `Bearer ${data.session.access_token}`)
    },
    onProgress: (bytesUploaded, bytesTotal) => {
      input.onProgress({ bytesUploaded, bytesTotal })
    },
    onError: input.onError,
    onSuccess: input.onSuccess,
  })

  return {
    async start() {
      if (!initialized) {
        const previousUploads = await upload.findPreviousUploads()
        if (previousUploads.length > 0) {
          upload.resumeFromPreviousUpload(previousUploads[0])
        }
        initialized = true
      }
      upload.start()
    },
    pause() {
      return upload.abort(false)
    },
    resume() {
      upload.start()
    },
  }
}
