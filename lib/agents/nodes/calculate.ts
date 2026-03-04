import { DEFAULT_CONFIG } from '@/constants'
import type { PresalesState, AgentCostEstimate } from '../state'

/**
 * 四舍五入到指定小数位
 */
function roundToDecimal(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}

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
  state: PresalesState
): Promise<Partial<PresalesState>> {
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
    const { roleSummary, additionalWork, bufferCoefficient } = state.estimation

    // 从系统配置获取参数（优先使用数据库配置，否则使用默认值）
    const laborCostPerDay = state.systemConfig?.laborCostPerDay || DEFAULT_CONFIG.LABOR_COST_PER_DAY

    // 1. 计算基础总人天（功能模块 + 额外工作）
    const moduleTotalDays = state.functions.reduce(
      (sum, f) => sum + f.roleEstimates.reduce((s, r) => s + r.days, 0),
      0
    )
    const additionalTotalDays = additionalWork.reduce((sum, w) => sum + w.days, 0)
    const baseDays = moduleTotalDays + additionalTotalDays

    // 2. 应用缓冲系数
    const bufferedDays = roundToDecimal(baseDays * bufferCoefficient, 1)

    console.log('[Agent] 成本计算:', {
      moduleTotalDays,
      additionalTotalDays,
      baseDays,
      bufferCoefficient,
      bufferedDays,
      laborCostPerDay,
    })

    // 3. 按角色计算成本（应用缓冲系数）
    const roleBreakdown = roleSummary.map((r) => ({
      role: r.role,
      days: roundToDecimal(r.totalDays * bufferCoefficient, 1),
      cost: Math.round(r.totalDays * bufferCoefficient * laborCostPerDay),
      headcount: r.headcount,
    }))

    // 4. 额外工作项成本
    const additionalWorkBreakdown = additionalWork.map((w) => ({
      workItem: w.workItem,
      days: roundToDecimal(w.days * bufferCoefficient, 1),
      cost: Math.round(w.days * bufferCoefficient * laborCostPerDay),
    }))

    // 5. 计算人力成本
    const laborCost = Math.round(bufferedDays * laborCostPerDay)

    // 6. 计算第三方服务成本（根据项目规模估算）
    const thirdPartyServices: { name: string; cost: number }[] = []

    // 根据团队规模估算云服务成本
    const teamSize = roleSummary.reduce((sum, r) => sum + r.headcount, 0)
    // 估算项目周期（按最大角色工时 / 人数计算）
    const maxRoleDays = Math.max(...roleSummary.map((r) => r.totalDays / r.headcount))
    const estimatedDuration = Math.ceil(maxRoleDays * bufferCoefficient)

    // 开发环境费用
    if (teamSize >= 3) {
      thirdPartyServices.push({
        name: '云服务器（开发测试环境）',
        cost: Math.ceil(estimatedDuration / 30) * 2000, // 每月约 2000 元
      })
    }

    // CI/CD 工具费用
    if (baseDays > 100) {
      thirdPartyServices.push({
        name: 'CI/CD 工具服务',
        cost: Math.ceil(estimatedDuration / 30) * 500,
      })
    }

    // 计算服务成本
    const serviceCost = thirdPartyServices.reduce((sum, s) => sum + s.cost, 0)

    // 基础设施成本（预留）
    const infrastructureCost = 0

    // 总成本
    const totalCost = laborCost + serviceCost + infrastructureCost

    // 构建成本估算结果
    const cost: AgentCostEstimate = {
      baseDays: roundToDecimal(baseDays, 1),
      bufferedDays,
      bufferCoefficient,
      roleBreakdown,
      additionalWorkBreakdown,
      laborCost,
      serviceCost,
      infrastructureCost,
      totalCost,
      thirdPartyServices,
    }

    console.log('[Agent] 成本计算完成:', {
      baseDays,
      bufferedDays,
      laborCost,
      serviceCost,
      totalCost,
      rolesCount: roleBreakdown.length,
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
