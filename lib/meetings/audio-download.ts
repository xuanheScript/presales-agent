import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const MAX_MEETING_AUDIO_BYTES = 500_000_000

export interface VerifiedMeetingAudio {
  directory: string
  path: string
  sizeBytes: number
  sha256: string
  cleanup: () => Promise<void>
}

export class MeetingAudioIntegrityError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'MeetingAudioIntegrityError'
  }
}

function storageObjectUrl(bucket: string, objectPath: string): URL {
  const supabaseUrl = process.env.SUPABASE_URL
  if (!supabaseUrl) {
    throw new Error('后台任务需要配置 SUPABASE_URL')
  }
  const baseUrl = new URL(supabaseUrl)
  const path = [bucket, ...objectPath.split('/')]
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return new URL(`/storage/v1/object/${path}`, baseUrl)
}

function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error('后台任务需要配置 SUPABASE_SERVICE_ROLE_KEY')
  }
  return key
}

export async function downloadAndVerifyMeetingAudio(input: {
  bucket: string
  objectPath: string
  expectedSizeBytes: number
  expectedSha256: string
  signal?: AbortSignal
}): Promise<VerifiedMeetingAudio> {
  if (input.expectedSizeBytes <= 0 || input.expectedSizeBytes > MAX_MEETING_AUDIO_BYTES) {
    throw new MeetingAudioIntegrityError('数据库中的音频大小无效', 'INVALID_MEDIA_SIZE')
  }
  if (!/^[0-9a-f]{64}$/.test(input.expectedSha256)) {
    throw new MeetingAudioIntegrityError('数据库中的音频摘要无效', 'INVALID_MEDIA_HASH')
  }

  const directory = await mkdtemp(join(tmpdir(), 'meeting-audio-'))
  const path = join(directory, 'source')
  const cleanup = () => rm(directory, { recursive: true, force: true })

  try {
    input.signal?.throwIfAborted()
    const key = serviceRoleKey()
    const response = await fetch(storageObjectUrl(input.bucket, input.objectPath), {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      signal: input.signal,
    })
    if (!response.ok || !response.body) {
      throw new MeetingAudioIntegrityError('从 Storage 下载会议音频失败', 'STORAGE_DOWNLOAD_FAILED')
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && Number(contentLength) !== input.expectedSizeBytes) {
      await response.body.cancel('audio size differs from database record')
      throw new MeetingAudioIntegrityError('Storage 音频大小与数据库记录不一致', 'MEDIA_SIZE_MISMATCH')
    }

    const hash = createHash('sha256')
    const output = await open(path, 'wx')
    let sizeBytes = 0
    try {
      const reader = response.body.getReader()
      try {
        while (true) {
          input.signal?.throwIfAborted()
          const { done, value } = await reader.read()
          if (done) break
          sizeBytes += value.byteLength
          if (sizeBytes > MAX_MEETING_AUDIO_BYTES || sizeBytes > input.expectedSizeBytes) {
            await reader.cancel('audio exceeds expected size')
            throw new MeetingAudioIntegrityError('Storage 音频大小超过数据库记录', 'MEDIA_SIZE_MISMATCH')
          }
          hash.update(value)
          await output.write(value)
        }
      } finally {
        reader.releaseLock()
      }
      await output.sync()
    } finally {
      await output.close()
    }

    if (sizeBytes !== input.expectedSizeBytes) {
      throw new MeetingAudioIntegrityError('Storage 音频大小与数据库记录不一致', 'MEDIA_SIZE_MISMATCH')
    }
    const sha256 = hash.digest('hex')
    if (sha256 !== input.expectedSha256) {
      throw new MeetingAudioIntegrityError('Storage 音频 SHA-256 与上传记录不一致', 'MEDIA_HASH_MISMATCH')
    }

    return { directory, path, sizeBytes, sha256, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

export function createMeetingAudioReadStream(path: string) {
  return createReadStream(path)
}
