import { describe, expect, it } from 'vitest'
import { getSupabaseTusEndpoint } from '@/lib/storage/resumable-upload'

describe('getSupabaseTusEndpoint', () => {
  it('uses the direct Storage hostname for hosted Supabase projects', () => {
    expect(getSupabaseTusEndpoint('https://wroyjvsryyfzdhbexskr.supabase.co')).toBe(
      'https://wroyjvsryyfzdhbexskr.storage.supabase.co/storage/v1/upload/resumable',
    )
  })

  it('keeps the configured origin for local or self-hosted projects', () => {
    expect(getSupabaseTusEndpoint('http://127.0.0.1:54321')).toBe(
      'http://127.0.0.1:54321/storage/v1/upload/resumable',
    )
  })
})
