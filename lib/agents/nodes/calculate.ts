import type { RunnableConfig } from '@langchain/core/runnables'
import { DEFAULT_CONFIG } from '@/constants'
import {
  FORMAL_COST_RULE_VERSION,
  calculateFormalCostV1,
} from '@/lib/domain/costing'
import { getRunnableSignal, throwIfAborted } from '../execution-policy'
import type { PresalesState, AgentCostEstimate } from '../state'

/**
 * 成本计算节点
 *
 * 基于功能模块列表和配置参数计算项目成本
 * 这个节点不需要 AI 调用，纯粹是数值计算
 *
 * 新版本计算逻辑：
 * 1. 从 state.estimation.roleSummary 获取按角色汇总的工时
 * 2. 使用系统配置的人天成本
 * 3. 使用 AI 评估的缓冲系数
 * 4. 输出按角色汇总的成本
 */
export async function calculateNode(
  state: PresalesState,
  config?: RunnableConfig
): Promise<Partial<PresalesState>> {
  throwIfAborted(getRunnableSignal(config))
  // 验证前置条件
  if (!state.functions || state.functions.length === 0) {
    return {
      error: '缺少功能模块列表，无法进行成本计算',
      currentStep: 'calculate',
    }
  }

  if (!state.estimation) {
    return {
      error: '缺少工时评估结果，无法进行成本计算',
      currentStep: 'calculate',
    }
  }

  try {
    const { bufferCoefficient } = state.estimation
    const laborCostPerDay = state.systemConfig?.laborCostPerDay ?? DEFAULT_CONFIG.LABOR_COST_PER_DAY
    const workingHoursPerDay = state.systemConfig?.workingHoursPerDay ?? DEFAULT_CONFIG.WORKING_HOURS_PER_DAY

    const result = calculateFormalCostV1({
      ruleVersion: FORMAL_COST_RULE_VERSION,
      currency: state.systemConfig?.currency ?? DEFAULT_CONFIG.CURRENCY,
      laborCostPerDay,
      workingHoursPerDay,
      bufferCoefficient,
      roles: state.identifiedRoles.map((role) => ({
        role: role.role,
        headcount: role.headcount,
      })),
      functions: state.functions.map((fn) => ({
        roleEfforts: fn.roleEstimates,
      })),
      additionalWork: state.additionalWork,
    })

    const cost: AgentCostEstimate = {
      ruleVersion: result.ruleVersion,
      servicePolicyVersion: result.servicePolicyVersion,
      currency: result.currency,
      laborCostPerDay: result.laborCostPerDay,
      workingHoursPerDay: result.workingHoursPerDay,
      baseDays: result.baseDays,
      bufferDays: result.bufferDays,
      bufferedDays: result.bufferedDays,
      bufferCoefficient: result.bufferCoefficient,
      estimatedDurationDays: result.estimatedDurationDays,
      staffingByRole: result.staffingByRole,
      roleBreakdown: result.functionalRoleBreakdown.map((role) => ({
        role: role.role,
        days: role.bufferedDays,
        baseDays: role.baseDays,
        cost: role.cost,
        headcount: role.headcount,
      })),
      additionalWorkBreakdown: result.additionalWorkBreakdown.map((work) => ({
        workItem: work.workItem,
        days: work.bufferedDays,
        baseDays: work.baseDays,
        cost: work.cost,
      })),
      laborCost: result.laborCost,
      serviceCost: result.serviceCost,
      infrastructureCost: result.infrastructureCost,
      totalCost: result.totalCost,
      thirdPartyServices: result.thirdPartyServices,
      reconciliation: result.reconciliation,
    }

    console.log('[Agent] 成本计算完成:', {
      ruleVersion: result.ruleVersion,
      baseDays: result.baseDays,
      bufferedDays: result.bufferedDays,
      laborCost: result.laborCost,
      serviceCost: result.serviceCost,
      totalCost: result.totalCost,
      rolesCount: result.functionalRoleBreakdown.length,
    })

    return {
      cost,
      currentStep: 'complete',
      isComplete: true,
      error: null,
    }
  } catch (error) {
    console.error('[Agent] 成本计算失败:', error)

    return {
      error: `成本计算失败: ${error instanceof Error ? error.message : '未知错误'}`,
      currentStep: 'calculate',
    }
  }
}

/**
 * 格式化金额显示
 */
export function formatCurrency(amount: number, currency = 'CNY'): string {
  if (currency === 'CNY') {
    return `¥${amount.toLocaleString('zh-CN')}`
  }
  return `$${amount.toLocaleString('en-US')}`
}

/**
 * 计算工时对应的人天
 */
export function hoursToWorkDays(hours: number): number {
  return Math.ceil(hours / DEFAULT_CONFIG.WORKING_HOURS_PER_DAY)
}
