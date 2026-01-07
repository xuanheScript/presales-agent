import { Annotation, MessagesAnnotation } from '@langchain/langgraph'
import type { ParsedRequirement, FunctionModule, EffortEstimation, CostEstimate } from '@/types'

/**
 * 售前成本估算 Agent 工作流状态定义
 *
 * 使用 LangGraph 的 Annotation 系统定义状态结构
 * 参考: https://langchain-ai.github.io/langgraphjs/
 */

// 工作流阶段类型
export type WorkflowStep = 'analyze' | 'breakdown' | 'estimate' | 'calculate' | 'complete'

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

// 功能模块输出（用于 Agent 输出）
export interface AgentFunctionModule {
  moduleName: string
  functionName: string
  description: string
  difficultyLevel: 'simple' | 'medium' | 'complex' | 'very_complex'
  estimatedHours: number
  dependencies?: string[]
}

// 工时评估输出
export interface AgentEffortEstimation {
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
}

// 成本计算输出
export interface AgentCostEstimate {
  laborCost: number
  serviceCost: number
  infrastructureCost: number
  bufferPercentage: number
  totalCost: number
  breakdown: {
    development: number
    testing: number
    deployment: number
    maintenance: number
    thirdPartyServices: {
      name: string
      cost: number
    }[]
  }
}

/**
 * 定义 Agent 工作流状态
 *
 * 使用 LangGraph 的 Annotation 系统，支持：
 * - 状态持久化
 * - 增量更新
 * - 类型安全
 */
export const PresalesStateAnnotation = Annotation.Root({
  // 继承消息历史（用于对话式交互）
  ...MessagesAnnotation.spec,

  // ========== 项目信息 ==========
  /** 项目 ID */
  projectId: Annotation<string>({
    default: () => '',
    reducer: (_, next) => next,
  }),

  /** 需求 ID */
  requirementId: Annotation<string>({
    default: () => '',
    reducer: (_, next) => next,
  }),

  /** 原始需求文本 */
  rawRequirement: Annotation<string>({
    default: () => '',
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
  requirementId: string,
  rawRequirement: string
): Partial<PresalesState> {
  return {
    projectId,
    requirementId,
    rawRequirement,
    messages: [],
    analysis: null,
    functions: [],
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
    estimation: state.estimation,
    cost: state.cost,
    error: state.error,
  }
}
