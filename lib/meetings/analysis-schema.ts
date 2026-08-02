import { z } from 'zod'

export const MEETING_ANALYSIS_PROMPT_VERSION = 'meeting-insights-v1'
export const MEETING_ANALYSIS_SCHEMA_VERSION = 'meeting-insights-schema-v1'
export const MEETING_ANALYSIS_CONFIG_VERSION = 'meeting-insights-config-v1'

export const MEETING_INSIGHT_CATEGORIES = [
  'requirement',
  'decision',
  'action_item',
  'risk',
  'conflict',
  'open_question',
  'out_of_scope',
] as const

export const meetingInsightCategorySchema = z.enum(MEETING_INSIGHT_CATEGORIES)

export const meetingAnalysisItemSchema = z.strictObject({
  category: meetingInsightCategorySchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(4_000),
  evidenceSegmentIds: z.array(z.uuid()).min(1).max(20),
})

export const meetingAnalysisChunkOutputSchema = z.strictObject({
  sourceId: z.string().regex(/^CHUNK-[A-F0-9]{20}$/),
  coverageStatus: z.enum(['insights', 'no_insights']),
  items: z.array(meetingAnalysisItemSchema).max(40),
})

export type MeetingInsightCategory = z.infer<typeof meetingInsightCategorySchema>
export type MeetingAnalysisItem = z.infer<typeof meetingAnalysisItemSchema>
export type MeetingAnalysisChunkOutput = z.infer<typeof meetingAnalysisChunkOutputSchema>

export interface MeetingAnalysisTranscriptSegment {
  id: string
  sequenceNo: number
  speakerKey: string | null
  startMs: number
  endMs: number
  text: string
}

export interface MeetingAnalysisChunk {
  sourceId: string
  index: number
  segments: MeetingAnalysisTranscriptSegment[]
  characterCount: number
  estimatedTokens: number
}

export interface MeetingAnalysisResult {
  summary: string
  items: MeetingAnalysisItem[]
  chunkCount: number
  segmentCount: number
  characterCount: number
  estimatedTokens: number
}
