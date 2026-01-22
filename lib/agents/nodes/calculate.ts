import { DEFAULT_CONFIG, DIFFICULTY_MULTIPLIERS } from '@/constants'
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
 * 计算逻辑：
 * 1. 从 state.functions 计算基础工时和加权工时
 * 2. 使用系统配置（从数据库读取）的人天成本和风险缓冲比例
 * 3. 使用 AI 返回的工时分解比例来分配各阶段成本
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
    const { breakdownRatio, teamComposition } = state.estimation

    // 从系统配置获取参数（优先使用数据库配置，否则使用默认值）
    const laborCostPerDay = state.systemConfig?.laborCostPerDay || DEFAULT_CONFIG.LABOR_COST_PER_DAY
    const workingHoursPerDay = state.systemConfig?.workingHoursPerDay || DEFAULT_CONFIG.WORKING_HOURS_PER_DAY
    const riskBufferPercentage = state.systemConfig?.riskBufferPercentage || DEFAULT_CONFIG.RISK_BUFFER_PERCENTAGE

    // 从功能模块列表计算基础工时和加权工时（代码计算，不依赖 AI）
    let baseHours = 0
    let weightedHours = 0
    for (const fn of state.functions) {
      baseHours += fn.estimatedHours
      const multiplier = DIFFICULTY_MULTIPLIERS[fn.difficultyLevel] || 1
      weightedHours += fn.estimatedHours * multiplier
    }

    console.log('[Agent] 工时计算（代码计算）:', {
      baseHours,
      weightedHours,
      laborCostPerDay,
      riskBufferPercentage,
    })

    // 使用加权工时计算人天数（保留小数，不取整）
    const totalHours = weightedHours
    const workDays = roundToDecimal(totalHours / workingHoursPerDay, 1)

    // 计算人力成本（使用精确的人天数）
    const laborCost = Math.round(workDays * laborCostPerDay)

    // 直接使用 AI 返回的比例（已在 estimate 节点归一化）
    const devRatio = breakdownRatio.development
    const testRatio = breakdownRatio.testing
    const integrationRatio = breakdownRatio.integration

    // 按比例分配加权工时到各阶段
    const developmentHours = totalHours * devRatio
    const testingHours = totalHours * testRatio
    const integrationHours = totalHours * integrationRatio

    // 计算各阶段人天数（保留小数）
    const developmentDays = roundToDecimal(developmentHours / workingHoursPerDay, 1)
    const testingDays = roundToDecimal(testingHours / workingHoursPerDay, 1)
    const integrationDays = roundToDecimal(integrationHours / workingHoursPerDay, 1)

    // 计算各阶段成本
    const developmentCost = Math.round(developmentDays * laborCostPerDay)
    const testingCost = Math.round(testingDays * laborCostPerDay)
    const integrationCost = Math.round(integrationDays * laborCostPerDay)

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
