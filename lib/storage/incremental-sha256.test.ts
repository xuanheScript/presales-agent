import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { IncrementalSha256, sha256File } from '@/lib/storage/incremental-sha256'

describe('IncrementalSha256', () => {
  it.each([
    '',
    'abc',
    '售前会议 FunASR test',
    'a'.repeat(10_000),
  ])('matches Node crypto for %j', (value) => {
    const bytes = new TextEncoder().encode(value)
    const hasher = new IncrementalSha256()
    for (let offset = 0; offset < bytes.length; offset += 7) {
      hasher.update(bytes.subarray(offset, offset + 7))
    }

    expect(hasher.digestHex()).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('hashes a Blob in bounded chunks and reports progress', async () => {
    const bytes = new Uint8Array(100_000)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251
    const progress: number[] = []

    const digest = await sha256File(new Blob([bytes]), {
      chunkSize: 8_192,
      onProgress: (hashed) => progress.push(hashed),
    })

    expect(digest).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(progress.at(-1)).toBe(bytes.length)
    expect(progress.length).toBeGreaterThan(1)
  })

  it('supports cancellation between chunks', async () => {
    const controller = new AbortController()
    const blob = new Blob([new Uint8Array(100)])

    await expect(sha256File(blob, {
      chunkSize: 10,
      signal: controller.signal,
      onProgress: () => controller.abort(),
    })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
