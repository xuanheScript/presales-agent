import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  downloadAndVerifyMeetingAudio,
} from '@/lib/meetings/audio-download'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  vi.unstubAllGlobals()
})

describe('meeting audio streaming download', () => {
  it('streams a private Storage object to disk and verifies its digest', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key'
    const content = new TextEncoder().encode('meeting audio bytes')
    const sha256 = createHash('sha256').update(content).digest('hex')
    let requestedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: URL | string, init?: RequestInit) => {
      requestedUrl = String(url)
      expect(init?.headers).toEqual({
        apikey: 'service-role-test-key',
        Authorization: 'Bearer service-role-test-key',
      })
      return new Response(new Blob([content]).stream(), {
        headers: { 'content-length': String(content.byteLength) },
      })
    }))

    const audio = await downloadAndVerifyMeetingAudio({
      bucket: 'meeting-audio',
      objectPath: 'user/project/会议 audio',
      expectedSizeBytes: content.byteLength,
      expectedSha256: sha256,
    })

    try {
      expect(requestedUrl).toBe(
        'https://project.supabase.co/storage/v1/object/meeting-audio/user/project/%E4%BC%9A%E8%AE%AE%20audio',
      )
      expect(new Uint8Array(await readFile(audio.path))).toEqual(content)
      expect(audio.sha256).toBe(sha256)
    } finally {
      await audio.cleanup()
    }
  })

  it('rejects a response whose content length differs from the database', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('short', {
      headers: { 'content-length': '5' },
    })))

    await expect(downloadAndVerifyMeetingAudio({
      bucket: 'meeting-audio',
      objectPath: 'user/project/audio',
      expectedSizeBytes: 6,
      expectedSha256: 'a'.repeat(64),
    })).rejects.toMatchObject({
      code: 'MEDIA_SIZE_MISMATCH',
    })
  })
})
