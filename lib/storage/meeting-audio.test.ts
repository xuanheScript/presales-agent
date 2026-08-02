import { describe, expect, it } from 'vitest'
import {
  MAX_MEETING_AUDIO_BYTES,
  MeetingAudioValidationError,
  formatFileSize,
  resolveMeetingAudioMimeType,
  validateMeetingAudioFile,
} from '@/lib/storage/meeting-audio'

describe('meeting audio validation', () => {
  it('accepts allowed declared MIME types', () => {
    expect(validateMeetingAudioFile({
      name: 'meeting.webm',
      size: 1024,
      type: 'audio/webm',
    })).toEqual({ mimeType: 'audio/webm' })
  })

  it('falls back to a supported extension when the browser omits MIME', () => {
    expect(resolveMeetingAudioMimeType({ name: 'meeting.M4A', type: '' })).toBe('audio/mp4')
  })

  it('rejects empty, oversized, and unsupported files', () => {
    expect(() => validateMeetingAudioFile({
      name: 'empty.wav',
      size: 0,
      type: 'audio/wav',
    })).toThrow(MeetingAudioValidationError)

    expect(() => validateMeetingAudioFile({
      name: 'large.wav',
      size: MAX_MEETING_AUDIO_BYTES + 1,
      type: 'audio/wav',
    })).toThrow('不能超过 500 MB')

    expect(() => validateMeetingAudioFile({
      name: 'meeting.txt',
      size: 100,
      type: 'text/plain',
    })).toThrow('不支持该音频格式')
  })

  it('formats progress byte counts', () => {
    expect(formatFileSize(10)).toBe('10 B')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})
