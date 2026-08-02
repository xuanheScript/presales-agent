export const MAX_MEETING_AUDIO_BYTES = 500_000_000

export const MEETING_AUDIO_MIME_TYPES = [
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/flac',
  'audio/x-flac',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/webm',
  'video/mp4',
] as const

const allowedMimeTypes = new Set<string>(MEETING_AUDIO_MIME_TYPES)

const extensionMimeTypes: Record<string, string> = {
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  webm: 'audio/webm',
}

export class MeetingAudioValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MeetingAudioValidationError'
  }
}

export function resolveMeetingAudioMimeType(file: Pick<File, 'name' | 'type'>): string | null {
  const declaredMimeType = file.type.trim().toLowerCase().split(';', 1)[0]
  if (allowedMimeTypes.has(declaredMimeType)) {
    return declaredMimeType
  }

  const extension = file.name.trim().toLowerCase().split('.').pop()
  return extension ? extensionMimeTypes[extension] ?? null : null
}

export function validateMeetingAudioFile(
  file: Pick<File, 'name' | 'size' | 'type'>,
): { mimeType: string } {
  if (file.size <= 0) {
    throw new MeetingAudioValidationError('音频文件不能为空')
  }
  if (file.size > MAX_MEETING_AUDIO_BYTES) {
    throw new MeetingAudioValidationError('音频文件不能超过 500 MB')
  }

  const mimeType = resolveMeetingAudioMimeType(file)
  if (!mimeType) {
    throw new MeetingAudioValidationError('不支持该音频格式，请选择 WAV、FLAC、MP3、OGG、WebM 或 MP4')
  }

  return { mimeType }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
