// 项目相关类型
export interface Project {
  id: string
  name: string
  description: string | null
  industry: string | null
  status: ProjectStatus
  created_at: string
  updated_at: string
  created_by: string
  current_requirement_baseline_id: string | null
  latest_estimate_version_id: string | null
  published_estimate_version_id: string | null
}

export type ProjectStatus = 'draft' | 'analyzing' | 'completed' | 'archived'

export type MeetingStatus =
  | 'draft'
  | 'uploading'
  | 'transcribing'
  | 'review_required'
  | 'analyzing'
  | 'estimate_ready'
  | 'published'
  | 'archived'

export interface Meeting {
  id: string
  project_id: string
  title: string
  status: MeetingStatus
  retention_days: 7 | 30 | 90
  created_by: string
  approved_transcript_revision_id: string | null
  latest_analysis_version_id: string | null
  latest_estimate_version_id: string | null
  created_at: string
  updated_at: string
}

export type MediaAssetStatus =
  | 'created'
  | 'uploading'
  | 'uploaded'
  | 'verified'
  | 'normalizing'
  | 'ready'
  | 'failed'
  | 'deleted'

export interface MediaAsset {
  id: string
  project_id: string
  meeting_id: string
  kind: 'original' | 'normalized' | 'provider_result'
  bucket: 'meeting-audio'
  object_path: string
  original_filename: string
  mime_type: string | null
  size_bytes: number | null
  duration_ms: number | null
  sha256: string | null
  status: MediaAssetStatus
  retention_until: string
  deleted_at: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export type ProcessingJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface ProcessingJob {
  id: string
  project_id: string
  meeting_id: string
  media_asset_id: string | null
  job_type: 'transcription' | 'meeting_analysis' | 'estimate_generation' | 'retention_cleanup'
  status: ProcessingJobStatus
  progress_percent: number
  stage: string
  event_sequence: number
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  finished_at: string | null
}

export interface MeetingWithLatestState extends Meeting {
  media_assets: MediaAsset[]
  processing_jobs: ProcessingJob[]
}

export type TranscriptRevisionStatus = 'draft' | 'in_review' | 'approved'

export interface TranscriptRevision {
  id: string
  project_id: string
  meeting_id: string
  revision_no: number
  parent_revision_id: string | null
  kind: 'machine' | 'human'
  status: TranscriptRevisionStatus
  full_text: string
  content_hash: string
  config_version: string | null
  created_at: string
  updated_at: string
  approved_at: string | null
}

export interface TranscriptWord {
  text: string
  startMs?: number
  endMs?: number
  confidence?: number
}

export interface TranscriptSegment {
  id: string
  project_id: string
  meeting_id: string
  transcript_revision_id: string
  sequence_no: number
  speaker_key: string | null
  start_ms: number
  end_ms: number
  text: string
  confidence: number | null
  words: TranscriptWord[]
  source_segment_id: string | null
  created_at: string
  updated_at: string
}

export interface TranscriptReviewData {
  revision: TranscriptRevision
  segments: TranscriptSegment[]
}

export type MeetingInsightCategory =
  | 'requirement'
  | 'decision'
  | 'action_item'
  | 'risk'
  | 'conflict'
  | 'open_question'
  | 'out_of_scope'

export type MeetingInsightReviewStatus = 'pending' | 'accepted' | 'excluded'

export interface MeetingAnalysisVersion {
  id: string
  project_id: string
  meeting_id: string
  transcript_revision_id: string
  revision_no: number
  parent_version_id: string | null
  status: 'in_review' | 'approved' | 'superseded'
  summary: string
  model_id: string
  prompt_version: string
  schema_version: string
  config_version: string
  created_at: string
  updated_at: string
  reviewed_at: string | null
}

export interface MeetingAnalysisItem {
  id: string
  project_id: string
  meeting_id: string
  analysis_version_id: string
  sequence_no: number
  category: MeetingInsightCategory
  title: string
  description: string
  review_status: MeetingInsightReviewStatus
  evidence: MeetingAnalysisEvidence[]
  created_at: string
  updated_at: string
}

export interface MeetingAnalysisEvidence {
  transcript_segment_id: string
  sequence_no: number
  segment: TranscriptSegment
}

export interface MeetingAnalysisReviewData {
  version: MeetingAnalysisVersion
  items: MeetingAnalysisItem[]
}

export type RequirementChangeOperation = 'add' | 'replace' | 'remove' | 'note'

export type RequirementChangeMappingStatus =
  | 'auto_mapped'
  | 'decision_required'
  | 'ready'

export type RequirementChangeDisposition = 'include' | 'omit'

export type RequirementChangeTarget =
  | 'requirements'
  | 'business_goals'
  | 'key_features'
  | 'tech_stack'
  | 'non_functional_requirements'
  | 'risks'
  | 'decisions'
  | 'action_items'
  | 'conflicts'
  | 'open_questions'
  | 'out_of_scope'

export type RequirementChangeSetStatus = 'in_review' | 'applied' | 'superseded'

export interface RequirementBaselineEntry {
  id: string
  title: string
  content: string
  kind: 'source' | 'change' | 'note'
  sourceRequirementId?: string
  elicitationSessionId?: string
  changeItemId?: string
}

export interface RequirementBaselineAppliedChange {
  changeItemId: string
  sourceAnalysisItemId: string
  category: MeetingInsightCategory
  operation: RequirementChangeOperation
  targetPath: RequirementChangeTarget
  targetEntryId?: string | null
  sourceTitle?: string
  sourceContent?: string
  title: string
  content: string
  mappingStatus?: RequirementChangeMappingStatus
  disposition?: RequirementChangeDisposition
}

export interface RequirementBaselineSnapshotV1 {
  schemaVersion: 'requirement-baseline-v1'
  projectDescription: string
  sourceRequirement: {
    id: string
    rawContent: string
    parsedContent: ParsedRequirement | null
  } | null
  sections: Record<RequirementChangeTarget, RequirementBaselineEntry[]>
  appliedChangeSets: Array<{
    changeSetId: string
    meetingId: string
    transcriptRevisionId: string
    analysisVersionId: string
    items: RequirementBaselineAppliedChange[]
  }>
}

export interface RequirementChangeSet {
  id: string
  project_id: string
  meeting_id: string
  analysis_version_id: string
  transcript_revision_id: string
  base_baseline_id: string | null
  base_requirement_id: string | null
  base_canonical_content: string
  base_content_hash: string
  base_snapshot: RequirementBaselineSnapshotV1
  base_project_description_snapshot: string
  status: RequirementChangeSetStatus
  superseded_by_change_set_id: string | null
  resulting_baseline_id: string | null
  created_at: string
  updated_at: string
  applied_at: string | null
  superseded_at: string | null
}

export interface RequirementChangeItem {
  id: string
  project_id: string
  change_set_id: string
  source_analysis_item_id: string
  source_analysis_version_id: string
  target_entry_id: string | null
  sequence_no: number
  category: MeetingInsightCategory
  operation: RequirementChangeOperation
  target_path: RequirementChangeTarget
  source_title: string
  source_content: string
  title: string
  content: string
  mapping_status: RequirementChangeMappingStatus
  disposition: RequirementChangeDisposition
  mapping_reason: string
  review_status: MeetingInsightReviewStatus
  created_at: string
  updated_at: string
}

export interface RequirementChangeSetReviewData {
  changeSet: RequirementChangeSet
  items: RequirementChangeItem[]
}

export interface RequirementBaseline {
  id: string
  project_id: string
  revision_no: number
  parent_baseline_id: string | null
  source_requirement_id: string | null
  source_meeting_id: string | null
  source_transcript_revision_id: string | null
  source_analysis_version_id: string | null
  applied_change_set_id: string | null
  canonical_content: string
  content_hash: string
  snapshot: RequirementBaselineSnapshotV1
  project_description_snapshot: string
  created_at: string
}

// 需求相关类型
export interface Requirement {
  id: string
  project_id: string
  raw_content: string
  parsed_content: ParsedRequirement | null
  file_url: string | null
  requirement_type: RequirementType
  source: 'manual' | 'upload' | 'elicitation'
  elicitation_session_id: string | null
  created_at: string
}

export type RequirementType = 'text' | 'document' | 'template'

export interface ParsedRequirement {
  projectType: string
  businessGoals: string[]
  keyFeatures: string[]
  techStack: string[]
  nonFunctionalRequirements: {
    performance?: string
    security?: string
    scalability?: string
  }
  risks: string[]
}

// 角色工时评估
export interface RoleEstimate {
  role: string
  days: number
  reason?: string
}

// 功能相关类型
export interface FunctionModule {
  id: string
  project_id: string
  module_name: string
  function_name: string
  description: string | null
  difficulty_level: DifficultyLevel
  estimated_hours: number
  dependencies: string[] | null
  role_estimates: RoleEstimate[] | null
  is_verified: boolean
  created_at: string
}

export type DifficultyLevel = 'simple' | 'medium' | 'complex' | 'very_complex'

// 成本估算相关类型
export interface CostEstimate {
  id: string
  project_id: string
  labor_cost: number
  service_cost: number
  infrastructure_cost: number
  buffer_percentage: number
  total_cost: number
  // 新增字段
  base_days?: number              // 基础总人天
  buffered_days?: number          // 含缓冲的总人天
  buffer_coefficient?: number     // 缓冲系数（1.0-2.5）
  rule_version?: string
  service_policy_version?: string
  currency?: string
  labor_cost_per_day?: number
  working_hours_per_day?: number
  breakdown: CostBreakdown
  created_at: string
  updated_at: string
}

// 角色成本分解
export interface RoleCostBreakdown {
  role: string
  days: number
  baseDays?: number
  cost: number
  headcount: number
}

// 额外工作成本分解
export interface AdditionalWorkCostBreakdown {
  workItem: string
  days: number
  baseDays?: number
  cost: number
}

// 第三方服务成本
export interface ThirdPartyServiceCost {
  code?: 'development_environment' | 'ci_cd'
  name: string
  quantity?: number
  unitCost?: number
  cost: number
}

export interface CostBreakdown {
  // 新版本：按角色分解
  roleBreakdown?: RoleCostBreakdown[]
  // 额外工作分解
  additionalWorkBreakdown?: AdditionalWorkCostBreakdown[]
  // 第三方服务
  thirdPartyServices?: ThirdPartyServiceCost[]
  bufferDays?: number
  estimatedDurationDays?: number
  reconciliation?: {
    laborLinesTotal: number
    laborCostDifference: number
    isBalanced: boolean
  }

  // 兼容旧版本字段（已废弃，仅用于旧数据展示）
  /** @deprecated 使用 roleBreakdown 替代 */
  development?: number
  /** @deprecated 使用 roleBreakdown 替代 */
  testing?: number
  /** @deprecated 使用 roleBreakdown 替代 */
  deployment?: number
  /** @deprecated 使用 roleBreakdown 替代 */
  maintenance?: number
}

// 模板相关类型
export interface Template {
  id: string
  template_type: TemplateType
  template_name: string
  prompt_content: string
  industry: string | null
  version: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export type TemplateType =
  | 'requirement_analysis'
  | 'function_breakdown'
  | 'effort_estimation'
  | 'cost_calculation'

// 功能分类
export interface FunctionCategory {
  id: string
  name: string
  sort_order: number
  is_preset: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

// 功能库相关类型
export interface FunctionLibraryItem {
  id: string
  function_name: string
  category: string
  description: string | null
  standard_hours: number
  complexity_factors: Record<string, number> | null
  reference_cost: number | null
  created_at: string
  updated_at: string
}

// 估算参考库类型
export interface EstimateReference {
  id: string
  module_name: string
  function_name: string
  description: string | null
  difficulty_level: DifficultyLevel
  role_estimates: RoleEstimate[]
  estimated_hours: number
  project_type: string | null
  category: string | null
  industry: string | null
  tech_stack: string[] | null
  source_project_id: string | null
  source_function_module_id: string | null
  usage_count: number
  verified_by: string | null
  created_at: string
  updated_at: string
}

// 功能组相关类型
export interface FunctionGroup {
  id: string
  name: string
  description: string | null
  created_by: string | null
  is_preset: boolean
  item_count: number
  total_standard_hours: number
  created_at: string
  updated_at: string
}

export interface FunctionGroupItemDetail {
  id: string
  function_library_id: string
  sort_order: number
  function_name: string
  category: string
  description: string | null
  standard_hours: number
  complexity_factors: Record<string, number> | null
}

export interface FunctionGroupWithItems extends FunctionGroup {
  items: FunctionGroupItemDetail[]
}

export interface FunctionGroupInput {
  name: string
  description?: string
  function_library_ids: string[]
}

// 快速估算 - 选中的功能项
export interface QuickEstimateItem {
  function_library_id: string
  function_name: string
  category: string
  standard_hours: number
  selected_factors: string[]
  complexity_multiplier: number
  adjusted_hours: number
}

// 快速估算记录
export interface QuickEstimate {
  id: string
  name: string
  description: string | null
  selected_items: QuickEstimateItem[]
  total_hours: number
  total_adjusted_hours: number
  buffer_coefficient: number
  labor_cost_per_day: number
  total_cost: number
  created_by: string
  created_at: string
  updated_at: string
}

export type AgentExecutionStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out'

export interface AgentExecution {
  id: string
  project_id: string
  requirement_id: string | null
  requirement_baseline_id: string | null
  requirement_baseline_content_hash: string | null
  estimate_version_id: string | null
  agent_type: string
  input_data: Record<string, unknown>
  output_data: unknown | null
  system_config_snapshot: Record<string, unknown> | null
  model_id: string | null
  workflow_version: string | null
  prompt_versions: Record<string, string> | null
  output_schema_version: string | null
  requested_by: string | null
  status: AgentExecutionStatus
  error_message: string | null
  execution_time_ms: number | null
  created_at: string
  completed_at: string | null
}

export interface EstimateVersion {
  id: string
  project_id: string
  revision_no: number
  parent_version_id: string | null
  requirement_baseline_id: string
  requirement_baseline_content_hash: string
  agent_execution_id: string | null
  generation_kind: 'ai_workflow' | 'manual_revision'
  input_snapshot: Record<string, unknown>
  system_config_snapshot: Record<string, unknown>
  parsed_requirement: ParsedRequirement
  output_snapshot: Record<string, unknown>
  snapshot_hash: string
  model_id: string
  workflow_version: string
  prompt_versions: Record<string, string>
  output_schema_version: string
  cost_rule_version: string
  service_policy_version: string
  created_by: string
  created_at: string
}

export interface EstimateVersionFunction {
  id: string
  estimate_version_id: string
  project_id: string
  sequence_no: number
  module_name: string
  function_name: string
  description: string | null
  difficulty_level: DifficultyLevel
  estimated_hours: number
  dependencies: string[] | null
  role_estimates: RoleEstimate[]
  is_verified: boolean
  created_at: string
}

export interface EstimateVersionRole {
  id: string
  estimate_version_id: string
  project_id: string
  sequence_no: number
  role_name: string
  responsibility: string | null
  headcount: number
  total_days: number
  created_at: string
}

export interface EstimateVersionAdditionalWork {
  id: string
  estimate_version_id: string
  project_id: string
  sequence_no: number
  work_item: string
  days: number
  assigned_roles: string[]
  created_at: string
}

export interface EstimateVersionCost extends CostEstimate {
  estimate_version_id: string
  project_id: string
}

export interface EstimateVersionSnapshot {
  version: EstimateVersion
  functions: EstimateVersionFunction[]
  roles: EstimateVersionRole[]
  additionalWork: EstimateVersionAdditionalWork[]
  cost: EstimateVersionCost | null
  pointer: 'latest' | 'published' | 'explicit'
}

// Agent 工作流相关类型
export interface AgentWorkflowResult {
  requirementAnalysis: ParsedRequirement
  functionBreakdown: FunctionModule[]
  effortEstimation: EffortEstimation
  costCalculation: CostEstimate
}

export interface EffortEstimation {
  totalHours: number
  breakdown: {
    development: number
    testing: number
    integration: number
  }
  teamComposition: {
    role: string
    count: number
    duration: number
  }[]
  timeline: {
    start: string
    end: string
    phases: {
      name: string
      duration: number
    }[]
  }
}

// 系统配置类型
export interface SystemConfig {
  id: string
  default_labor_cost_per_day: number
  default_risk_buffer_percentage: number
  currency: string
  updated_at: string
  updated_by: string
}

// 聊天会话类型
export interface ChatSession {
  id: string
  project_id: string
  title: string | null
  created_at: string
  updated_at: string
}

// 聊天消息类型（与 UIMessage 兼容）
export interface ChatMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  parts: Array<{
    type: string
    text?: string
    [key: string]: unknown
  }>
  created_at: string
}

// Elicitation 会话类型
export interface ElicitationSession {
  id: string
  project_id: string
  status: 'active' | 'completed' | 'cancelled'
  current_round: number
  max_rounds: number
  collected_info: ElicitationCollectedInfo
  current_questions: ElicitationQuestion[]
  completion_summary: string | null
  input_requirement_baseline_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface ElicitationCollectedInfo {
  // === 项目基础（对应 ParsedRequirement.projectType） ===
  projectType?: string
  projectSummary?: string

  // === 业务目标（对应 ParsedRequirement.businessGoals） ===
  businessGoals?: string[]

  // === 功能范围（对应 ParsedRequirement.keyFeatures） ===
  keyFeatures?: string[]
  outOfScope?: string[]

  // === 技术相关（对应 ParsedRequirement.techStack） ===
  techStack?: string[]
  platforms?: string[] // Web/Mobile/Desktop/小程序等
  integrations?: string[] // 第三方集成需求

  // === 非功能需求（对应 ParsedRequirement.nonFunctionalRequirements） ===
  nonFunctionalRequirements?: {
    performance?: string // 性能要求
    security?: string // 安全要求
    scalability?: string // 扩展性/并发要求
    availability?: string // 可用性要求
  }

  // === 用户与场景 ===
  targetUsers?: string[]
  userVolume?: string
  useCases?: string[]

  // === 约束与风险（对应 ParsedRequirement.risks） ===
  constraints?: string[] // 技术/业务约束
  risks?: string[] // 潜在风险

  // === 时间与预算 ===
  timeline?: {
    deadline?: string
    priority?: 'urgent' | 'normal' | 'flexible'
  }
  budget?: string

  // === 元信息（用于进度跟踪） ===
  _meta?: {
    lastUpdatedRound: number
    confirmedFields: string[] // 已确认的字段列表
  }
}

export interface ElicitationMessage {
  id: string
  session_id: string
  round: number
  role: 'assistant' | 'user'
  content: string
  questions?: ElicitationQuestion[]
  extracted_info?: Partial<ElicitationCollectedInfo> | null
  created_at: string
}

// 选项式问题的选项
export interface ElicitationOption {
  id: string
  label: string
  description?: string
}

// 引导问题（带选项）
export interface ElicitationQuestion {
  id: string
  question: string
  description?: string // 问题的补充说明
  options: ElicitationOption[]
  allowMultiple?: boolean // 是否允许多选
  allowCustom?: boolean // 是否允许自定义输入
  fieldKey?: string // 对应要更新的字段
}

// 用户对问题的回答
export interface ElicitationAnswer {
  questionId: string
  selectedOptions: string[] // 选中的选项 id 列表
  customInput?: string // 自定义输入内容
}

// 聊天模式类型
export type ChatMode = 'internal' | 'elicitation'

// AI 生成的引导状态
export interface ElicitationState {
  currentQuestions: ElicitationQuestion[] // 当前待回答的问题
  answeredCount: number // 已回答的问题数量
  isComplete: boolean // AI 判断是否已完成
  summary?: string // AI 对当前收集信息的总结
}
