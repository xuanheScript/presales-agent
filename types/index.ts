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
