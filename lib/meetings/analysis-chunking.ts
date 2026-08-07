import { createHash } from 'node:crypto'
import type {
  MeetingAnalysisChunk,
  MeetingAnalysisChunkOutput,
  MeetingAnalysisItem,
  MeetingAnalysisTranscriptSegment,
} from '@/lib/meetings/analysis-schema'

export const ANALYSIS_CHUNK_TARGET_CHARS = 7_000
export const ANALYSIS_CHUNK_MAX_CHARS = 9_000
export const ANALYSIS_CHUNK_MAX_ESTIMATED_TOKENS = 6_000
export const ANALYSIS_CHUNK_MAX_SEGMENTS = 120
export const ANALYSIS_MAX_CHUNKS = 60
export const ANALYSIS_MAX_ITEMS = 300
export const ANALYSIS_LEASE_SECONDS = 1_800

export class MeetingAnalysisValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'MeetingAnalysisValidationError'
  }
}

export function estimateMeetingTokens(value: string): number {
  let asciiCount = 0
  let nonAsciiCount = 0
  for (const char of value) {
    if (char.codePointAt(0)! <= 0x7f) asciiCount += 1
    else nonAsciiCount += 1
  }
  return Math.ceil(asciiCount / 4 + nonAsciiCount / 1.5)
}

function sourceId(index: number, segmentIds: string[]): string {
  return `CHUNK-${createHash('sha256')
    .update(`${index}\0${segmentIds.join('\0')}`, 'utf8')
    .digest('hex')
    .slice(0, 20)
    .toUpperCase()}`
}

function segmentCharacters(segment: MeetingAnalysisTranscriptSegment): number {
  return segment.text.trim().length + (segment.speakerKey?.length ?? 0) + 64
}

function createChunk(
  index: number,
  segments: MeetingAnalysisTranscriptSegment[],
): MeetingAnalysisChunk {
  const characterCount = segments.reduce((sum, segment) => sum + segmentCharacters(segment), 0)
  return {
    sourceId: sourceId(index, segments.map((segment) => segment.id)),
    index,
    segments,
    characterCount,
    estimatedTokens: estimateMeetingTokens(
      segments.map((segment) => segment.text).join('\n'),
    ),
  }
}

export function chunkTranscriptSegments(
  segments: MeetingAnalysisTranscriptSegment[],
): MeetingAnalysisChunk[] {
  if (segments.length === 0) {
    throw new MeetingAnalysisValidationError('EMPTY_TRANSCRIPT', '批准稿没有可分析的转写片段')
  }

  const chunks: MeetingAnalysisChunk[] = []
  let current: MeetingAnalysisTranscriptSegment[] = []
  let currentChars = 0

  for (const segment of segments) {
    const text = segment.text.trim()
    if (!text) {
      throw new MeetingAnalysisValidationError(
        'EMPTY_SEGMENT',
        `批准稿包含空转写片段（序号 ${segment.sequenceNo}）`,
      )
    }
    const normalized = { ...segment, text }
    const chars = segmentCharacters(normalized)
    const tokens = estimateMeetingTokens(text)
    if (chars > ANALYSIS_CHUNK_MAX_CHARS || tokens > ANALYSIS_CHUNK_MAX_ESTIMATED_TOKENS) {
      throw new MeetingAnalysisValidationError(
        'SEGMENT_TOO_LARGE',
        `转写片段 ${segment.sequenceNo} 超过会议分析单片限制，请先拆分校对稿`,
      )
    }

    const candidateSegments = [...current, normalized]
    const candidateText = candidateSegments.map((item) => item.text).join('\n')
    const exceedsHardLimit = (
      current.length > 0 && (
        candidateSegments.length > ANALYSIS_CHUNK_MAX_SEGMENTS
        || currentChars + chars > ANALYSIS_CHUNK_MAX_CHARS
        || estimateMeetingTokens(candidateText) > ANALYSIS_CHUNK_MAX_ESTIMATED_TOKENS
      )
    )
    const reachedTarget = current.length > 0 && currentChars >= ANALYSIS_CHUNK_TARGET_CHARS

    if (exceedsHardLimit || reachedTarget) {
      chunks.push(createChunk(chunks.length, current))
      current = [normalized]
      currentChars = chars
    } else {
      current = candidateSegments
      currentChars += chars
    }
  }

  if (current.length > 0) chunks.push(createChunk(chunks.length, current))
  if (chunks.length > ANALYSIS_MAX_CHUNKS) {
    throw new MeetingAnalysisValidationError(
      'TOO_MANY_CHUNKS',
      `会议转写需要 ${chunks.length} 个分析切片，超过上限 ${ANALYSIS_MAX_CHUNKS}`,
    )
  }
  return chunks
}

export function validateChunkAnalysis(
  chunk: MeetingAnalysisChunk,
  output: MeetingAnalysisChunkOutput,
): MeetingAnalysisItem[] {
  if (output.sourceId !== chunk.sourceId) {
    throw new MeetingAnalysisValidationError(
      'SOURCE_MISMATCH',
      `会议分析切片来源不匹配（${chunk.index + 1}）`,
    )
  }
  if (
    (output.coverageStatus === 'no_insights' && output.items.length !== 0)
    || (output.coverageStatus === 'insights' && output.items.length === 0)
  ) {
    throw new MeetingAnalysisValidationError(
      'COVERAGE_MISMATCH',
      `会议分析切片覆盖状态与洞察数量不一致（${chunk.index + 1}）`,
    )
  }

  const segmentIds = new Set(chunk.segments.map((segment) => segment.id))
  const identities = new Set<string>()
  return output.items.map((item) => {
    if (new Set(item.evidenceSegmentIds).size !== item.evidenceSegmentIds.length) {
      throw new MeetingAnalysisValidationError(
        'DUPLICATE_EVIDENCE',
        `会议洞察“${item.title}”包含重复证据片段`,
      )
    }
    if (item.evidenceSegmentIds.some((id) => !segmentIds.has(id))) {
      throw new MeetingAnalysisValidationError(
        'EVIDENCE_OUTSIDE_CHUNK',
        `会议洞察“${item.title}”引用了当前切片之外的证据`,
      )
    }

    const identity = `${item.category}\0${item.title.normalize('NFKC').toLocaleLowerCase('zh-CN')}`
    if (identities.has(identity)) {
      throw new MeetingAnalysisValidationError(
        'DUPLICATE_ITEM',
        `会议分析切片重复返回洞察“${item.title}”`,
      )
    }
    identities.add(identity)
    return item
  })
}

function normalizedIdentity(item: MeetingAnalysisItem): string {
  const normalized = `${item.category}\0${item.title}\0${item.description}`
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
  return normalized
}

export function mergeMeetingAnalysisItems(
  items: MeetingAnalysisItem[],
): MeetingAnalysisItem[] {
  const merged = new Map<string, MeetingAnalysisItem>()
  for (const item of items) {
    const identity = normalizedIdentity(item)
    const existing = merged.get(identity)
    if (!existing) {
      merged.set(identity, item)
      continue
    }
    const evidenceSegmentIds = [
      ...new Set([...existing.evidenceSegmentIds, ...item.evidenceSegmentIds]),
    ]
    merged.set(identity, { ...existing, evidenceSegmentIds: evidenceSegmentIds.slice(0, 20) })
  }
  const result = [...merged.values()]
  if (result.length > ANALYSIS_MAX_ITEMS) {
    throw new MeetingAnalysisValidationError(
      'TOO_MANY_ITEMS',
      `会议分析生成 ${result.length} 条洞察，超过上限 ${ANALYSIS_MAX_ITEMS}`,
    )
  }
  return result
}
