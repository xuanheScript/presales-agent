import { DEFAULT_CONFIG } from '@/constants'
import type { PresalesState, AgentCostEstimate } from '../state'

/**
 * 成本计算节点
 *
 * 基于工时评估结果和配置参数计算项目成本
 * 这个节点不需要 AI 调用，纯粹是数值计算
 */
export async function calculateNode(
  state: PresalesState
): Promise<Partial<PresalesState>> {
  // 验证前置条件
  if (!state.estimation) {
    return {
      error: '缺少工时评估结果，无法进行成本计算',
      currentStep: 'calculate',
    }
  }

  try {
    const { totalHours, breakdown, teamComposition } = state.estimation

    // 配置参数
    const laborCostPerDay = DEFAULT_CONFIG.LABOR_COST_PER_DAY
    const workingHoursPerDay = DEFAULT_CONFIG.WORKING_HOURS_PER_DAY
    const riskBufferPercentage = DEFAULT_CONFIG.RISK_BUFFER_PERCENTAGE

    // 计算人天数
    const workDays = Math.ceil(totalHours / workingHoursPerDay)

    // 计算人力成本
    const laborCost = workDays * laborCostPerDay

    // 计算各阶段成本
    const developmentDays = Math.ceil(breakdown.development / workingHoursPerDay)
    const testingDays = Math.ceil(breakdown.testing / workingHoursPerDay)
    const integrationDays = Math.ceil(breakdown.integration / workingHoursPerDay)

    const developmentCost = developmentDays * laborCostPerDay
    const testingCost = testingDays * laborCostPerDay
    const integrationCost = integrationDays * laborCostPerDay

    // 计算第三方服务成本（根据项目规模估算）
    const thirdPartyServices: { name: string; cost: number }[] = []

    // 根据团队规模估算云服务成本
    const teamSize = teamComposition.reduce((sum, t) => sum + t.count, 0)
    const avgDuration = teamComposition.reduce((sum, t) => sum + t.duration, 0) / teamComposition.length

    // 开发环境费用
    if (teamSize >= 3) {
      thirdPartyServices.push({
        name: '云服务器（开发测试环境）',
        cost: Math.ceil(avgDuration / 30) * 2000, // 每月约 2000 元
      })
    }

    // CI/CD 工具费用
    if (totalHours > 200) {
      thirdPartyServices.push({
        name: 'CI/CD 工具服务',
        cost: Math.ceil(avgDuration / 30) * 500,
      })
    }

    // 计算服务成本
    const serviceCost = thirdPartyServices.reduce((sum, s) => sum + s.cost, 0)

    // 基础设施成本（预留）
    const infrastructureCost = 0

    // 基础成本小计
    const baseCost = laborCost + serviceCost + infrastructureCost

    // 计算风险缓冲
    const bufferAmount = Math.round(baseCost * (riskBufferPercentage / 100))

    // 总成本
    const totalCost = baseCost + bufferAmount

    // 构建成本估算结果
    const cost: AgentCostEstimate = {
      laborCost,
      serviceCost,
      infrastructureCost,
      bufferPercentage: riskBufferPercentage,
      totalCost,
      breakdown: {
        development: developmentCost,
        testing: testingCost,
        deployment: integrationCost, // 使用集成费用作为部署费用
        maintenance: 0, // 维护费用需要单独评估
        thirdPartyServices,
      },
    }

    console.log('[Agent] 成本计算完成:', {
      laborCost,
      serviceCost,
      bufferAmount,
      totalCost,
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
