import { StateGraph, START, END } from '@langchain/langgraph'
import {
  createManagedAbortSignal,
  EXECUTION_POLICY,
  isAbortError,
  withAbortSignal,
  type WorkflowRunOptions,
} from './execution-policy'
import {
  PresalesStateAnnotation,
  createInitialState,
  extractWorkflowResult,
  type PresalesState,
  type WorkflowResult,
  type WorkflowSystemConfig,
} from './state'
import { analyzeNode } from './nodes/analyze'
import { breakdownNode } from './nodes/breakdown'
import { estimateNode } from './nodes/estimate'
import { calculateNode } from './nodes/calculate'

/**
 * 条件路由函数
 *
 * 根据当前状态决定下一个执行节点
 */
function shouldContinue(state: PresalesState): string {
  // 如果有错误，直接结束
  if (state.error) {
    console.log('[Graph] 检测到错误，终止工作流:', state.error)
    return 'end'
  }

  // 根据当前步骤决定下一步
  switch (state.currentStep) {
    case 'breakdown':
      return 'breakdown'
    case 'estimate':
      return 'estimate'
    case 'calculate':
      return 'calculate'
    case 'complete':
      return 'end'
    default:
      return 'end'
  }
}

/**
 * 创建售前成本估算工作流图
 *
 * 工作流程：
 * START → analyze → breakdown → estimate → calculate → END
 *
 * 每个节点都可能因错误提前终止工作流
 */
const workflow = new StateGraph(PresalesStateAnnotation)
  // 添加节点
  .addNode('analyze', analyzeNode)
  .addNode('breakdown', breakdownNode)
  .addNode('estimate', estimateNode)
  .addNode('calculate', calculateNode)

  // 定义边：从 START 到 analyze
  .addEdge(START, 'analyze')

  // analyze 节点的条件路由
  .addConditionalEdges('analyze', shouldContinue, {
    breakdown: 'breakdown',
    end: END,
  })

  // breakdown 节点的条件路由
  .addConditionalEdges('breakdown', shouldContinue, {
    estimate: 'estimate',
    end: END,
  })

  // estimate 节点的条件路由
  .addConditionalEdges('estimate', shouldContinue, {
    calculate: 'calculate',
    end: END,
  })

  // calculate 节点的条件路由
  .addConditionalEdges('calculate', shouldContinue, {
    end: END,
  })

/**
 * 编译后的工作流实例
 */
export const presalesGraph = workflow.compile()

/**
 * 运行售前成本估算工作流
 *
 * @param projectId - 项目 ID
 * @param requirementBaselineId - 需求基线 ID
 * @param canonicalRequirement - 规范化需求基线正文
 * @param projectDescription - 项目描述
 * @param systemConfig - 系统配置（人天成本、风险缓冲比例等）
 * @returns 工作流执行结果
 */
export async function runPresalesWorkflow(
  projectId: string,
  requirementBaselineId: string,
  canonicalRequirement: string,
  projectDescription: string = '',
  systemConfig: WorkflowSystemConfig | null = null,
  options: WorkflowRunOptions = {},
  analysisPromptTemplate: string = ''
): Promise<WorkflowResult> {
  console.log('[Graph] 开始执行售前成本估算工作流:', {
    projectId,
    requirementBaselineId,
    requirementLength: canonicalRequirement.length,
    systemConfig,
  })

  const startTime = Date.now()

  try {
    // 创建初始状态
    const initialState = createInitialState(
      projectId,
      requirementBaselineId,
      canonicalRequirement,
      projectDescription,
      systemConfig,
      analysisPromptTemplate
    )

    return await withAbortSignal(
      [options.signal],
      options.timeoutMs ?? EXECUTION_POLICY.presalesRouteTimeoutMs,
      async (signal) => {
        const finalState = await presalesGraph.invoke(initialState, {
          signal,
          configurable: {
            executionId: options.executionId,
          },
        })
        return extractWorkflowResult(finalState)
      }
    )
  } catch (error) {
    const duration = Date.now() - startTime
    console.error('[Graph] 工作流执行失败:', {
      duration: `${duration}ms`,
      error,
    })

    if (isAbortError(error, options.signal)) {
      throw error
    }

    return {
      success: false,
      analysis: null,
      functions: [],
      identifiedRoles: [],
      additionalWork: [],
      estimation: null,
      cost: null,
      error: error instanceof Error ? error.message : '工作流执行失败',
    }
  }
}

/**
 * 流式执行售前成本估算工作流
 *
 * @param projectId - 项目 ID
 * @param requirementBaselineId - 需求基线 ID
 * @param canonicalRequirement - 规范化需求基线正文
 * @param projectDescription - 项目描述
 * @param systemConfig - 系统配置（人天成本、风险缓冲比例等）
 * @returns AsyncIterable 流式状态更新
 */
export async function* streamPresalesWorkflow(
  projectId: string,
  requirementBaselineId: string,
  canonicalRequirement: string,
  projectDescription: string = '',
  systemConfig: WorkflowSystemConfig | null = null,
  options: WorkflowRunOptions = {},
  analysisPromptTemplate: string = ''
): AsyncIterable<{ step: string; state: Partial<PresalesState> }> {
  console.log('[Graph] 开始流式执行工作流')

  const initialState = createInitialState(
    projectId,
    requirementBaselineId,
    canonicalRequirement,
    projectDescription,
    systemConfig,
    analysisPromptTemplate
  )
  const managed = createManagedAbortSignal(
    [options.signal],
    options.timeoutMs ?? EXECUTION_POLICY.presalesRouteTimeoutMs
  )

  try {
    const stream = await presalesGraph.stream(initialState, {
      streamMode: 'values',
      signal: managed.signal,
      configurable: {
        executionId: options.executionId,
      },
    })

    for await (const state of stream) {
      yield {
        step: state.currentStep,
        state: {
          currentStep: state.currentStep,
          analysis: state.analysis,
          functions: state.functions,
          identifiedRoles: state.identifiedRoles,
          additionalWork: state.additionalWork,
          estimation: state.estimation,
          cost: state.cost,
          error: state.error,
          isComplete: state.isComplete,
        },
      }
    }
  } finally {
    managed.dispose()
  }
}

/**
 * 获取工作流步骤信息
 */
export const WORKFLOW_STEPS = [
  {
    key: 'analyze',
    label: '需求分析',
    description: '提取项目类型、业务目标、核心功能',
  },
  {
    key: 'breakdown',
    label: '功能拆解',
    description: '拆分功能模块、查询功能库',
  },
  {
    key: 'estimate',
    label: '工时评估',
    description: '计算开发工时、人员配置',
  },
  {
    key: 'calculate',
    label: '成本计算',
    description: '计算人力成本、生成报价',
  },
] as const

export type WorkflowStepKey = (typeof WORKFLOW_STEPS)[number]['key']
