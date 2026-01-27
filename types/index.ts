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
}

export type ProjectStatus = 'draft' | 'analyzing' | 'completed' | 'archived'

// 需求相关类型
export interface Requirement {
  id: string
  project_id: string
  raw_content: string
  parsed_content: ParsedRequirement | null
  file_url: string | null
  requirement_type: RequirementType
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
  breakdown: CostBreakdown
  created_at: string
  updated_at: string
}

export interface CostBreakdown {
  development: number
  testing: number
  deployment: number
  maintenance: number
  thirdPartyServices: Array<{
    name: string
    cost: number
  }>
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
