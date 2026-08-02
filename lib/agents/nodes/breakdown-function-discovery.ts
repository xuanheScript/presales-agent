import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AgentFunctionModule } from '../state'

export const SOURCE_CHUNK_TARGET_CHARS = 3_600
export const SOURCE_CHUNK_MAX_CHARS = 4_500
export const SOURCE_CHUNK_TARGET_ESTIMATED_TOKENS = 2_400
export const SOURCE_CHUNK_MAX_ESTIMATED_TOKENS = 3_000
export const SOURCE_CHUNK_OVERLAP_CHARS = 600
export const SOURCE_CHUNK_MAX_COUNT = 12
export const SOURCE_CHUNK_MAX_FUNCTIONS = 12
export const SOURCE_EVIDENCE_MIN_CHARS = 4

export interface RequirementSourceChunk {
  sourceId: string
  ordinal: number
  text: string
  startOffset: number
  endOffset: number
  focusStartOffset: number
  focusEndOffset: number
  estimatedTokens: number
}

export const functionDiscoverySchema = z.object({
  sourceId: z.string().regex(/^SRC-[A-F0-9]{20}$/),
  coverageStatus: z.enum(['functions', 'no_functions']),
  functions: z.array(z.object({
    moduleName: z.string().trim().min(1).max(100),
    functionName: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(500),
    evidenceQuote: z.string().trim().min(SOURCE_EVIDENCE_MIN_CHARS).max(500),
  })).max(SOURCE_CHUNK_MAX_FUNCTIONS),
})

export type FunctionDiscoveryOutput = z.infer<typeof functionDiscoverySchema>

export interface FunctionDiscoveryEvidenceLine {
  evidenceId: string
  quote: string
}

export const evidenceAnchoredFunctionDiscoverySchema = z.object({
  sourceId: z.string().regex(/^SRC-[A-F0-9]{20}$/),
  coverageStatus: z.enum(['functions', 'no_functions']),
  functions: z.array(z.object({
    moduleName: z.string().trim().min(1).max(100),
    functionName: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(500),
    evidenceId: z.string().regex(/^EVID-\d{4}$/),
  })).max(SOURCE_CHUNK_MAX_FUNCTIONS),
})

export type EvidenceAnchoredFunctionDiscoveryOutput = z.infer<
  typeof evidenceAnchoredFunctionDiscoverySchema
>

export interface ValidatedFunctionDiscovery {
  sourceId: string
  coverageStatus: FunctionDiscoveryOutput['coverageStatus']
  functions: FunctionDiscoveryOutput['functions']
}

export interface FunctionDiscoveryValidationIssue {
  code:
    | 'wrong_source_id'
    | 'coverage_status_mismatch'
    | 'duplicate_function'
    | 'evidence_outside_focus'
  message: string
}

export type FunctionDiscoveryValidationResult =
  | { success: true; discovery: ValidatedFunctionDiscovery }
  | { success: false; issue: FunctionDiscoveryValidationIssue }

interface ChunkingOptions {
  targetChars: number
  maxChars: number
  targetEstimatedTokens: number
  maxEstimatedTokens: number
  overlapChars: number
  maxChunks: number
}

interface SourceBlock {
  text: string
  startOffset: number
  endOffset: number
  protected: boolean
}

interface SourceLine {
  text: string
  startOffset: number
  contentEndOffset: number
  endOffset: number
}

const DEFAULT_CHUNKING_OPTIONS: ChunkingOptions = {
  targetChars: SOURCE_CHUNK_TARGET_CHARS,
  maxChars: SOURCE_CHUNK_MAX_CHARS,
  targetEstimatedTokens: SOURCE_CHUNK_TARGET_ESTIMATED_TOKENS,
  maxEstimatedTokens: SOURCE_CHUNK_MAX_ESTIMATED_TOKENS,
  overlapChars: SOURCE_CHUNK_OVERLAP_CHARS,
  maxChunks: SOURCE_CHUNK_MAX_COUNT,
}

function normalizeIdentity(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('zh-CN')
}

export function estimateRequirementTokens(value: string): number {
  let asciiCount = 0
  let nonAsciiCount = 0

  for (const char of value) {
    if (char.codePointAt(0)! <= 0x7f) {
      asciiCount += 1
    } else {
      nonAsciiCount += 1
    }
  }

  return Math.ceil(asciiCount / 4 + nonAsciiCount / 1.5)
}

function isWithinLimit(
  value: string,
  maxChars: number,
  maxEstimatedTokens: number
): boolean {
  return value.length <= maxChars && estimateRequirementTokens(value) <= maxEstimatedTokens
}

function createLines(requirement: string): SourceLine[] {
  const lines: SourceLine[] = []
  let startOffset = 0

  while (startOffset < requirement.length) {
    let contentEndOffset = startOffset
    while (
      contentEndOffset < requirement.length &&
      requirement[contentEndOffset] !== '\n' &&
      requirement[contentEndOffset] !== '\r'
    ) {
      contentEndOffset += 1
    }

    let endOffset = contentEndOffset
    if (requirement[endOffset] === '\r') endOffset += 1
    if (requirement[endOffset] === '\n') endOffset += 1

    lines.push({
      text: requirement.slice(startOffset, contentEndOffset),
      startOffset,
      contentEndOffset,
      endOffset,
    })
    startOffset = endOffset
  }

  return lines
}

function isBlankLine(line: SourceLine): boolean {
  return line.text.trim().length === 0
}

function isListLine(line: SourceLine): boolean {
  return /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line.text)
}

function isIndentedLine(line: SourceLine): boolean {
  return /^(?: {2,}|\t)/.test(line.text)
}

function isTableStart(lines: SourceLine[], index: number): boolean {
  const current = lines[index]?.text || ''
  const next = lines[index + 1]?.text || ''

  return current.includes('|') && /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(next)
}

function isMarkdownBlockStart(lines: SourceLine[], index: number): boolean {
  const current = lines[index]?.text || ''
  const next = lines[index + 1]?.text || ''

  return (
    /^ {0,3}#{1,6}(?:\s+|$)/.test(current) ||
    /^ {0,3}>/.test(current) ||
    /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(current) ||
    /^ {0,3}:{3,}(?:\s+.*)?$/.test(current) ||
    /^ {0,3}<(?:!--|\/?[A-Za-z][A-Za-z0-9-]*(?:\s|>|\/))/i.test(current) ||
    /^ {0,3}(?:=+|-+)\s*$/.test(next)
  )
}

function lineRangeToBlock(
  requirement: string,
  lines: SourceLine[],
  startIndex: number,
  endIndex: number,
  protectedBlock: boolean
): SourceBlock {
  const startOffset = lines[startIndex].startOffset
  const endOffset = lines[endIndex].contentEndOffset

  return {
    text: requirement.slice(startOffset, endOffset),
    startOffset,
    endOffset,
    protected: protectedBlock,
  }
}

function parseMarkdownBlocks(requirement: string): SourceBlock[] {
  const lines = createLines(requirement)
  const blocks: SourceBlock[] = []
  let index = 0

  while (index < lines.length) {
    if (isBlankLine(lines[index])) {
      index += 1
      continue
    }

    const fenceMatch = lines[index].text.match(/^\s*(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      const minimumLength = fenceMatch[1].length
      const startIndex = index
      index += 1
      while (index < lines.length) {
        const closingFence = lines[index].text.match(/^\s*(`{3,}|~{3,})\s*$/)
        if (
          closingFence &&
          closingFence[1][0] === marker &&
          closingFence[1].length >= minimumLength
        ) {
          index += 1
          break
        }
        index += 1
      }
      blocks.push(lineRangeToBlock(requirement, lines, startIndex, index - 1, true))
      continue
    }

    if (isListLine(lines[index])) {
      const startIndex = index
      let lastContentIndex = index
      index += 1
      while (index < lines.length) {
        if (isListLine(lines[index]) || isIndentedLine(lines[index])) {
          lastContentIndex = index
          index += 1
          continue
        }
        if (isBlankLine(lines[index])) {
          let nextIndex = index + 1
          while (nextIndex < lines.length && isBlankLine(lines[nextIndex])) nextIndex += 1
          if (
            nextIndex < lines.length &&
            (isListLine(lines[nextIndex]) || isIndentedLine(lines[nextIndex]))
          ) {
            index = nextIndex
            continue
          }
          break
        }
        if (
          !isTableStart(lines, index) &&
          !isMarkdownBlockStart(lines, index) &&
          !/^\s*(`{3,}|~{3,})/.test(lines[index].text)
        ) {
          // CommonMark 允许列表项使用未缩进的 lazy continuation 行。
          lastContentIndex = index
          index += 1
          continue
        }
        break
      }
      blocks.push(lineRangeToBlock(requirement, lines, startIndex, lastContentIndex, true))
      continue
    }

    if (isTableStart(lines, index)) {
      const startIndex = index
      let lastContentIndex = index + 1
      index += 2
      while (index < lines.length && lines[index].text.includes('|')) {
        lastContentIndex = index
        index += 1
      }
      blocks.push(lineRangeToBlock(requirement, lines, startIndex, lastContentIndex, true))
      continue
    }

    const startIndex = index
    let lastContentIndex = index
    index += 1
    while (
      index < lines.length &&
      !isBlankLine(lines[index]) &&
      !isListLine(lines[index]) &&
      !isTableStart(lines, index) &&
      !isMarkdownBlockStart(lines, index) &&
      !/^\s*(`{3,}|~{3,})/.test(lines[index].text)
    ) {
      lastContentIndex = index
      index += 1
    }
    blocks.push(lineRangeToBlock(requirement, lines, startIndex, lastContentIndex, false))
  }

  return blocks
}

function adjustForSurrogatePair(value: string, offset: number): number {
  if (
    offset > 0 &&
    offset < value.length &&
    /[\uDC00-\uDFFF]/.test(value[offset]) &&
    /[\uD800-\uDBFF]/.test(value[offset - 1])
  ) {
    return offset - 1
  }
  return offset
}

function findPlainSplitOffset(
  requirement: string,
  startOffset: number,
  endOffset: number,
  options: ChunkingOptions
): number {
  let limit = Math.min(endOffset, startOffset + options.targetChars)
  limit = adjustForSurrogatePair(requirement, limit)

  while (
    limit > startOffset &&
    estimateRequirementTokens(requirement.slice(startOffset, limit)) > options.targetEstimatedTokens
  ) {
    limit = adjustForSurrogatePair(requirement, limit - 1)
  }
  if (limit <= startOffset) {
    throw new Error('需求段落超过同步切片 token 上限')
  }
  if (limit === endOffset) return limit

  const candidate = requirement.slice(startOffset, limit)
  const minimumSemanticOffset = Math.floor(candidate.length * 0.5)
  let semanticOffset = -1
  for (const match of candidate.matchAll(/[。！？!?；;\n]/gu)) {
    const matchEnd = (match.index || 0) + match[0].length
    if (matchEnd >= minimumSemanticOffset) semanticOffset = matchEnd
  }

  return semanticOffset > 0
    ? startOffset + semanticOffset
    : limit
}

function splitPlainBlock(
  requirement: string,
  block: SourceBlock,
  options: ChunkingOptions
): SourceBlock[] {
  const parts: SourceBlock[] = []
  let startOffset = block.startOffset

  while (startOffset < block.endOffset) {
    let endOffset = findPlainSplitOffset(
      requirement,
      startOffset,
      block.endOffset,
      options
    )
    while (endOffset < block.endOffset && /\s/u.test(requirement[endOffset])) {
      endOffset += 1
    }

    const text = requirement.slice(startOffset, endOffset)
    if (!isWithinLimit(text, options.maxChars, options.maxEstimatedTokens)) {
      throw new Error('需求段落超过同步切片上限')
    }
    parts.push({
      text,
      startOffset,
      endOffset,
      protected: false,
    })
    startOffset = endOffset
  }

  return parts
}

function createSourceBlocks(
  requirement: string,
  options: ChunkingOptions
): SourceBlock[] {
  if (!requirement.trim()) {
    throw new Error('原始需求不能为空')
  }

  const blocks: SourceBlock[] = []
  for (const block of parseMarkdownBlocks(requirement)) {
    if (isWithinLimit(block.text, options.maxChars, options.maxEstimatedTokens)) {
      blocks.push(block)
      continue
    }
    if (block.protected) {
      throw new Error('Markdown 表格、列表或代码块超过同步切片上限，无法在不破坏结构的情况下拆分')
    }
    blocks.push(...splitPlainBlock(requirement, block, options))
  }

  return blocks
}

function createSourceId(
  requirementBaselineId: string,
  focusText: string,
  occurrence: number
): string {
  const digest = createHash('sha256')
    .update([
      'source-chunk-v1',
      normalizeIdentity(requirementBaselineId),
      normalizeIdentity(focusText),
      String(occurrence),
    ].join('\0'))
    .digest('hex')
    .slice(0, 20)
    .toUpperCase()

  return `SRC-${digest}`
}

export function getSourceFocusText(source: RequirementSourceChunk): string {
  return source.text.slice(
    source.focusStartOffset - source.startOffset,
    source.focusEndOffset - source.startOffset
  )
}

export function getSourceContextText(source: RequirementSourceChunk): string {
  return source.text.slice(0, source.focusStartOffset - source.startOffset)
}

export function chunkRequirement(
  requirementBaselineId: string,
  requirement: string,
  overrides: Partial<ChunkingOptions> = {}
): RequirementSourceChunk[] {
  if (!requirementBaselineId.trim()) {
    throw new Error('需求 ID 不能为空')
  }

  const options = { ...DEFAULT_CHUNKING_OPTIONS, ...overrides }
  if (
    options.targetChars <= 0 ||
    options.maxChars < options.targetChars ||
    options.targetEstimatedTokens <= 0 ||
    options.maxEstimatedTokens < options.targetEstimatedTokens ||
    options.overlapChars < 0 ||
    options.maxChunks <= 0
  ) {
    throw new Error('需求切片参数无效')
  }

  const blocks = createSourceBlocks(requirement, options)
  const coreChunks: SourceBlock[][] = []
  let current: SourceBlock[] = []

  for (const block of blocks) {
    const proposed = [...current, block]
    const proposedText = requirement.slice(
      proposed[0].startOffset,
      proposed[proposed.length - 1].endOffset
    )

    if (
      current.length === 0 ||
      isWithinLimit(
        proposedText,
        options.targetChars,
        options.targetEstimatedTokens
      )
    ) {
      current = proposed
      continue
    }

    coreChunks.push(current)
    current = [block]
  }
  if (current.length > 0) coreChunks.push(current)

  if (coreChunks.length > options.maxChunks) {
    throw new Error(`同步功能发现最多支持 ${options.maxChunks} 个需求切片`)
  }

  const focusOccurrences = new Map<string, number>()

  return coreChunks.map((core, index) => {
    const focusStartOffset = core[0].startOffset
    const focusEndOffset = core[core.length - 1].endOffset
    let startOffset = focusStartOffset

    if (index > 0 && options.overlapChars > 0) {
      const previous = coreChunks[index - 1]
      for (let blockIndex = previous.length - 1; blockIndex >= 0; blockIndex--) {
        const candidateStart = previous[blockIndex].startOffset
        const overlapLength = focusStartOffset - candidateStart
        const candidateText = requirement.slice(candidateStart, focusEndOffset)
        if (
          overlapLength > options.overlapChars ||
          !isWithinLimit(
            candidateText,
            options.maxChars,
            options.maxEstimatedTokens
          )
        ) {
          break
        }
        startOffset = candidateStart
      }
    }

    const text = requirement.slice(startOffset, focusEndOffset)
    const focusText = requirement.slice(focusStartOffset, focusEndOffset)
    const focusIdentity = normalizeIdentity(focusText)
    const occurrence = focusOccurrences.get(focusIdentity) || 0
    focusOccurrences.set(focusIdentity, occurrence + 1)
    const estimatedTokens = estimateRequirementTokens(text)

    if (!isWithinLimit(text, options.maxChars, options.maxEstimatedTokens)) {
      throw new Error(`需求切片 ${index + 1} 超过同步处理上限`)
    }

    return {
      sourceId: createSourceId(requirementBaselineId, focusText, occurrence),
      ordinal: index,
      text,
      startOffset,
      endOffset: focusEndOffset,
      focusStartOffset,
      focusEndOffset,
      estimatedTokens,
    }
  })
}

export function createFunctionDiscoveryEvidenceLines(
  source: RequirementSourceChunk
): FunctionDiscoveryEvidenceLine[] {
  const focusText = getSourceFocusText(source)
  const lines: FunctionDiscoveryEvidenceLine[] = []
  let lineStartOffset = 0

  for (let index = 0; index <= focusText.length; index++) {
    const reachedEnd = index === focusText.length
    const reachedBreak = !reachedEnd && (
      focusText[index] === '\n' || focusText[index] === '\r'
    )
    if (!reachedEnd && !reachedBreak) continue

    const quote = focusText.slice(lineStartOffset, index).trim()
    if (quote.length >= SOURCE_EVIDENCE_MIN_CHARS) {
      lines.push({
        evidenceId: `EVID-${String(lines.length + 1).padStart(4, '0')}`,
        quote,
      })
    }

    if (!reachedEnd) {
      if (focusText[index] === '\r' && focusText[index + 1] === '\n') index += 1
      lineStartOffset = index + 1
    }
  }

  if (lines.length === 0) {
    throw new Error(`来源 ${source.sourceId} 的当前焦点没有可引用证据`)
  }

  return lines
}

export function resolveEvidenceAnchoredFunctionDiscovery(
  evidenceLines: FunctionDiscoveryEvidenceLine[],
  output: EvidenceAnchoredFunctionDiscoveryOutput
): FunctionDiscoveryOutput {
  const evidenceById = new Map(
    evidenceLines.map(({ evidenceId, quote }) => [evidenceId, quote])
  )

  return {
    sourceId: output.sourceId,
    coverageStatus: output.coverageStatus,
    functions: output.functions.map((candidate) => {
      const evidenceQuote = evidenceById.get(candidate.evidenceId)
      if (!evidenceQuote) {
        throw new Error(
          `功能 ${candidate.moduleName}/${candidate.functionName} 引用了未知证据 ID: ${candidate.evidenceId}`
        )
      }

      return {
        moduleName: candidate.moduleName,
        functionName: candidate.functionName,
        description: candidate.description,
        evidenceQuote,
      }
    }),
  }
}

export function checkFunctionDiscovery(
  source: RequirementSourceChunk,
  output: FunctionDiscoveryOutput
): FunctionDiscoveryValidationResult {
  if (output.sourceId !== source.sourceId) {
    return {
      success: false,
      issue: {
        code: 'wrong_source_id',
        message: `功能发现返回了错误的来源 ID: ${output.sourceId}`,
      },
    }
  }
  if (output.coverageStatus === 'no_functions' && output.functions.length > 0) {
    return {
      success: false,
      issue: {
        code: 'coverage_status_mismatch',
        message: `来源 ${source.sourceId} 声明无功能但返回了功能`,
      },
    }
  }
  if (output.coverageStatus === 'functions' && output.functions.length === 0) {
    return {
      success: false,
      issue: {
        code: 'coverage_status_mismatch',
        message: `来源 ${source.sourceId} 声明有功能但未返回功能`,
      },
    }
  }

  const focusText = getSourceFocusText(source)
  const seenFunctions = new Set<string>()

  for (const candidate of output.functions) {
    const identity = `${normalizeIdentity(candidate.moduleName)}\0${normalizeIdentity(candidate.functionName)}`
    if (seenFunctions.has(identity)) {
      return {
        success: false,
        issue: {
          code: 'duplicate_function',
          message: `来源 ${source.sourceId} 重复返回功能: ${candidate.moduleName}/${candidate.functionName}`,
        },
      }
    }
    seenFunctions.add(identity)

    if (!focusText.includes(candidate.evidenceQuote)) {
      return {
        success: false,
        issue: {
          code: 'evidence_outside_focus',
          message: `功能 ${candidate.moduleName}/${candidate.functionName} 的证据不属于来源 ${source.sourceId} 的当前焦点`,
        },
      }
    }
  }

  return {
    success: true,
    discovery: {
      sourceId: source.sourceId,
      coverageStatus: output.coverageStatus,
      functions: output.functions,
    },
  }
}

export function validateFunctionDiscovery(
  source: RequirementSourceChunk,
  output: FunctionDiscoveryOutput
): ValidatedFunctionDiscovery {
  const result = checkFunctionDiscovery(source, output)
  if (!result.success) {
    throw new Error(result.issue.message)
  }

  return result.discovery
}

export function mergeFunctionDiscoveries(
  sources: RequirementSourceChunk[],
  discoveries: ValidatedFunctionDiscovery[]
): AgentFunctionModule[] {
  if (discoveries.length !== sources.length) {
    throw new Error(`功能发现覆盖了 ${discoveries.length} 个来源，预期 ${sources.length} 个`)
  }

  const discoveryBySourceId = new Map<string, ValidatedFunctionDiscovery>()
  for (const discovery of discoveries) {
    if (discoveryBySourceId.has(discovery.sourceId)) {
      throw new Error(`功能发现重复覆盖来源: ${discovery.sourceId}`)
    }
    discoveryBySourceId.set(discovery.sourceId, discovery)
  }

  const merged = new Map<string, AgentFunctionModule>()
  for (const source of sources) {
    const discovery = discoveryBySourceId.get(source.sourceId)
    if (!discovery) {
      throw new Error(`功能发现缺少来源: ${source.sourceId}`)
    }

    for (const candidate of discovery.functions) {
      const identity = `${normalizeIdentity(candidate.moduleName)}\0${normalizeIdentity(candidate.functionName)}`
      const existing = merged.get(identity)
      if (!existing) {
        merged.set(identity, {
          moduleName: candidate.moduleName,
          functionName: candidate.functionName,
          description: candidate.description,
          difficultyLevel: 'medium',
          roleEstimates: [],
          dependencies: [],
        })
        continue
      }

      const preferredDescription = [existing.description, candidate.description]
        .sort((left, right) => (
          right.length - left.length || left.localeCompare(right, 'zh-CN')
        ))[0]
      existing.description = preferredDescription
    }
  }

  if (merged.size === 0) {
    throw new Error('所有需求切片均未发现功能')
  }

  return Array.from(merged.values())
}
