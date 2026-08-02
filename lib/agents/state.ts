import { Annotation } from '@langchain/langgraph'

/**
 * 售前成本估算 Agent 工作流状态定义
 *
 * 使用 LangGraph 的 Annotation 系统定义状态结构
 * 参考: https://langchain-ai.github.io/langgraphjs/
 */

// 工作流阶段类型
export type WorkflowStep = 'analyze' | 'breakdown' | 'estimate' | 'calculate' | 'complete'

// 系统配置（用于成本计算）
export interface WorkflowSystemConfig {
  laborCostPerDay: number
  riskBufferPercentage: number
  workingHoursPerDay: number
  currency: string
}

// Agent 分析结果（与 ParsedRequirement 对齐但独立定义以便扩展）
export interface AgentAnalysisResult {
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

// 角色工时评估（动态角色）
export interface RoleEstimate {
  role: string           // 角色名称，如：后端开发、嵌入式工程师、算法工程师
  days: number           // 该角色工时（人天）
  reason?: string        // 工时评估依据（若偏离参考范围需说明）
}

// 功能模块输出（用于 Agent 输出）- 支持动态角色
export interface AgentFunctionModule {
  moduleName: string
  functionName: string
  description: string
  difficultyLevel: 'simple' | 'medium' | 'complex' | 'very_complex'
  // 改为按角色评估工时（动态角色数组）
  roleEstimates: RoleEstimate[]
  dependencies?: string[]
}

// 额外工作项（非功能开发工作）
export interface AdditionalWorkItem {
  workItem: string                // 工作项名称，如：技术架构设计、联调测试
  days: number                    // 工时（人天）
  assignedRoles: string[]         // 由哪些角色承担
}

// 识别出的项目角色
export interface IdentifiedRole {
  role: string                    // 角色名称
  responsibility: string          // 职责描述
  headcount: number               // 建议人数
}

// 工时评估输出 - 新版本支持动态角色汇总
export interface AgentEffortEstimation {
  // 识别出的项目所需角色
  identifiedRoles: IdentifiedRole[]
  // 额外工作项
  additionalWork: AdditionalWorkItem[]
  // 按角色汇总的工时（从功能模块自动计算）
  roleSummary: {
    role: string
    totalDays: number     // 该角色总工时（人天）
    headcount: number     // 建议人数
  }[]
  // 缓冲系数（根据项目类型自动判断：1.2-2.0）
  bufferCoefficient: number
  // 缓冲系数说明
  bufferReason: string
}

// 成本计算输出 - 支持动态角色汇总
export interface AgentCostEstimate {
  ruleVersion: 'formal-workflow-v1'
  servicePolicyVersion: 'formal-service-v1'
  currency: string
  laborCostPerDay: number
  workingHoursPerDay: number

  // 基础工时统计
  baseDays: number                    // 基础总人天（功能模块 + 额外工作）
  bufferDays: number                  // 风险缓冲增加的人天
  bufferedDays: number                // 含缓冲的总人天
  bufferCoefficient: number           // 缓冲系数
  estimatedDurationDays: number       // 按角色人数推算的含缓冲周期
  staffingByRole: {
    role: string
    functionalDays: number
    additionalDays: number
    totalDays: number
    headcount: number
  }[]

  // 按角色汇总（只包含功能开发工作）
  roleBreakdown: {
    role: string
    days: number                      // 含缓冲功能人天
    baseDays: number                  // 基础功能人天
    cost: number
    headcount: number
  }[]

  // 额外工作独立汇总
  additionalWorkBreakdown: {
    workItem: string
    days: number                      // 含缓冲额外工作人天
    baseDays: number
    cost: number
  }[]

  // 成本汇总
  laborCost: number                   // 人力成本
  serviceCost: number                 // 第三方服务成本
  infrastructureCost: number          // 基础设施成本
  totalCost: number                   // 总成本（含缓冲）

  // 第三方服务明细
  thirdPartyServices: {
    code: 'development_environment' | 'ci_cd'
    name: string
    quantity: number
    unitCost: number
    cost: number
  }[]

  reconciliation: {
    laborLinesTotal: number
    laborCostDifference: number
    isBalanced: boolean
  }
}

/**
 * 定义 Agent 工作流状态
 *
 * 使用 LangGraph 的 Annotation 系统，支持：
 * - 请求内状态增量更新
 * - 类型安全
 */
export const PresalesStateAnnotation = Annotation.Root({
  // ========== 项目信息 ==========
  /** 项目 ID */
  projectId: Annotation<string>({
    default: () => '',
    reducer: (_, next) => next,
  }),

  /** 需求 ID */
  requirementBaselineId: Annotation<string>({
    default: () => '',
    reducer: (_, next) => next,
  }),

  /** 原始需求文本 */
  canonicalRequirement: Annotation<string>({
    default: () => '',
    reducer: (_, next) => next,
  }),

  /** 项目描述 */
  projectDescription: Annotation<string>({
    default: () => '',
    reducer: (_, next) => next,
  }),

  /** 本次执行固定的需求分析提示词 */
  analysisPromptTemplate: Annotation<string>({
    default: () => '',
    reducer: (_, next) => next,
  }),

  /** 系统配置（用于成本计算） */
  systemConfig: Annotation<WorkflowSystemConfig | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),

  // ========== 各阶段输出 ==========
  /** 需求分析结果 */
  analysis: Annotation<AgentAnalysisResult | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),

  /** 功能模块列表 */
  functions: Annotation<AgentFunctionModule[]>({
    default: () => [],
    reducer: (_, next) => next,
  }),

  /** 识别出的项目角色 */
  identifiedRoles: Annotation<IdentifiedRole[]>({
    default: () => [],
    reducer: (_, next) => next,
  }),

  /** 额外工作项（非功能开发工作） */
  additionalWork: Annotation<AdditionalWorkItem[]>({
    default: () => [],
    reducer: (_, next) => next,
  }),

  /** 工时评估结果 */
  estimation: Annotation<AgentEffortEstimation | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),

  /** 成本计算结果 */
  cost: Annotation<AgentCostEstimate | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),

  // ========== 工作流控制 ==========
  /** 当前执行阶段 */
  currentStep: Annotation<WorkflowStep>({
    default: () => 'analyze',
    reducer: (_, next) => next,
  }),

  /** 错误信息 */
  error: Annotation<string | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),

  /** 是否已完成 */
  isComplete: Annotation<boolean>({
    default: () => false,
    reducer: (_, next) => next,
  }),
})

/** 工作流状态类型 */
export type PresalesState = typeof PresalesStateAnnotation.State

/**
 * 创建初始状态
 */
export function createInitialState(
  projectId: string,
  requirementBaselineId: string,
  canonicalRequirement: string,
  projectDescription: string = '',
  systemConfig: WorkflowSystemConfig | null = null,
  analysisPromptTemplate: string = ''
): Partial<PresalesState> {
  return {
    projectId,
    requirementBaselineId,
    canonicalRequirement,
    projectDescription,
    systemConfig,
    analysisPromptTemplate,
    analysis: null,
    functions: [],
    identifiedRoles: [],
    additionalWork: [],
    estimation: null,
    cost: null,
    currentStep: 'analyze',
    error: null,
    isComplete: false,
  }
}

/**
 * 工作流结果类型
 */
export interface WorkflowResult {
  success: boolean
  analysis: AgentAnalysisResult | null
  functions: AgentFunctionModule[]
  identifiedRoles: IdentifiedRole[]
  additionalWork: AdditionalWorkItem[]
  estimation: AgentEffortEstimation | null
  cost: AgentCostEstimate | null
  error: string | null
}

/**
 * 从最终状态提取工作流结果
 */
export function extractWorkflowResult(state: PresalesState): WorkflowResult {
  return {
    success: state.isComplete && !state.error,
    analysis: state.analysis,
    functions: state.functions,
    identifiedRoles: state.identifiedRoles,
    additionalWork: state.additionalWork,
    estimation: state.estimation,
    cost: state.cost,
    error: state.error,
  }
}
