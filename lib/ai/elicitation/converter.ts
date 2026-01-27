import type { ElicitationCollectedInfo, ParsedRequirement } from '@/types'

/**
 * 将 ElicitationCollectedInfo 转换为 ParsedRequirement
 *
 * 这是澄清模式完成后的关键步骤，确保两种模式产出一致的数据结构
 */
export function convertToParseRequirement(
  info: ElicitationCollectedInfo
): ParsedRequirement {
  // 项目类型：直接映射或从概述推断
  const projectType = info.projectType || inferProjectType(info)

  // 业务目标：合并显式目标和从使用场景推断的目标
  const businessGoals = mergeBusinessGoals(info)

  // 核心功能：直接映射
  const keyFeatures = info.keyFeatures || []

  // 技术栈：合并技术栈和平台信息
  const techStack = mergeTechStack(info)

  // 非功能需求：直接映射，过滤空值
  const nonFunctionalRequirements = {
    performance: info.nonFunctionalRequirements?.performance,
    security: info.nonFunctionalRequirements?.security,
    scalability: buildScalabilityRequirement(info),
  }

  // 风险：合并显式风险和从约束推断的风险
  const risks = mergeRisks(info)

  return {
    projectType,
    businessGoals,
    keyFeatures,
    techStack,
    nonFunctionalRequirements,
    risks,
  }
}

/**
 * 从收集的信息推断项目类型
 */
function inferProjectType(info: ElicitationCollectedInfo): string {
  if (info.projectSummary) {
    // 简单关键词匹配推断
    const summary = info.projectSummary.toLowerCase()
    if (summary.includes('电商') || summary.includes('商城')) return '电商平台'
    if (summary.includes('管理') || summary.includes('后台')) return '管理系统'
    if (summary.includes('小程序')) return '小程序应用'
    if (summary.includes('app') || summary.includes('移动')) return '移动应用'
    if (summary.includes('官网') || summary.includes('门户')) return '门户网站'
    if (summary.includes('saas') || summary.includes('平台')) return 'SaaS平台'
  }

  // 从平台推断
  if (info.platforms?.length) {
    const platforms = info.platforms.join(',').toLowerCase()
    if (platforms.includes('小程序')) return '小程序应用'
    if (platforms.includes('app') || platforms.includes('ios') || platforms.includes('android')) {
      return '移动应用'
    }
  }

  return '软件系统'
}

/**
 * 合并业务目标
 */
function mergeBusinessGoals(info: ElicitationCollectedInfo): string[] {
  const goals: string[] = []

  // 添加显式业务目标
  if (info.businessGoals?.length) {
    goals.push(...info.businessGoals)
  }

  // 从使用场景推断补充目标
  if (info.useCases?.length && goals.length < 3) {
    for (const useCase of info.useCases) {
      const inferredGoal = `支持${useCase}`
      if (!goals.includes(inferredGoal)) {
        goals.push(inferredGoal)
      }
    }
  }

  // 从目标用户推断
  if (info.targetUsers?.length && goals.length < 3) {
    const userGoal = `服务${info.targetUsers.join('、')}用户群体`
    if (!goals.some((g) => g.includes('用户'))) {
      goals.push(userGoal)
    }
  }

  return goals
}

/**
 * 合并技术栈信息
 */
function mergeTechStack(info: ElicitationCollectedInfo): string[] {
  const stack: string[] = []

  // 添加显式技术栈
  if (info.techStack?.length) {
    stack.push(...info.techStack)
  }

  // 添加平台相关技术
  if (info.platforms?.length) {
    for (const platform of info.platforms) {
      const normalized = platform.toLowerCase()
      if (normalized.includes('web') && !stack.some((s) => s.toLowerCase().includes('web'))) {
        stack.push('Web')
      }
      if (
        (normalized.includes('ios') || normalized.includes('android')) &&
        !stack.some((s) => s.toLowerCase().includes('mobile'))
      ) {
        stack.push('移动端')
      }
      if (
        normalized.includes('小程序') &&
        !stack.some((s) => s.toLowerCase().includes('小程序'))
      ) {
        stack.push('微信小程序')
      }
    }
  }

  // 添加集成相关
  if (info.integrations?.length) {
    for (const integration of info.integrations) {
      if (!stack.includes(integration)) {
        stack.push(integration)
      }
    }
  }

  return stack
}

/**
 * 构建扩展性需求描述
 */
function buildScalabilityRequirement(info: ElicitationCollectedInfo): string | undefined {
  const parts: string[] = []

  if (info.nonFunctionalRequirements?.scalability) {
    parts.push(info.nonFunctionalRequirements.scalability)
  }

  if (info.userVolume) {
    parts.push(`预期用户规模: ${info.userVolume}`)
  }

  if (info.nonFunctionalRequirements?.availability) {
    parts.push(`可用性要求: ${info.nonFunctionalRequirements.availability}`)
  }

  return parts.length > 0 ? parts.join('; ') : undefined
}

/**
 * 合并风险信息
 */
function mergeRisks(info: ElicitationCollectedInfo): string[] {
  const risks: string[] = []

  // 添加显式风险
  if (info.risks?.length) {
    risks.push(...info.risks)
  }

  // 从约束推断潜在风险
  if (info.constraints?.length) {
    for (const constraint of info.constraints) {
      const riskFromConstraint = `约束条件带来的风险: ${constraint}`
      if (!risks.some((r) => r.includes(constraint))) {
        risks.push(riskFromConstraint)
      }
    }
  }

  // 从时间线推断风险
  if (info.timeline?.priority === 'urgent') {
    const timeRisk = '紧急时间要求可能影响交付质量'
    if (!risks.some((r) => r.includes('时间'))) {
      risks.push(timeRisk)
    }
  }

  return risks
}

/**
 * 将原始需求文本与收集的信息合并，生成完整的需求描述
 */
export function buildRawRequirementFromCollectedInfo(
  info: ElicitationCollectedInfo,
  originalInput?: string
): string {
  const sections: string[] = []

  // 项目概述
  if (info.projectSummary || originalInput) {
    sections.push(`## 项目概述\n${info.projectSummary || originalInput}`)
  }

  // 业务目标
  if (info.businessGoals?.length) {
    sections.push(`## 业务目标\n${info.businessGoals.map((g) => `- ${g}`).join('\n')}`)
  }

  // 核心功能
  if (info.keyFeatures?.length) {
    sections.push(`## 核心功能\n${info.keyFeatures.map((f) => `- ${f}`).join('\n')}`)
  }

  // 目标用户
  if (info.targetUsers?.length) {
    let userSection = `## 目标用户\n${info.targetUsers.map((u) => `- ${u}`).join('\n')}`
    if (info.userVolume) {
      userSection += `\n\n预期用户规模: ${info.userVolume}`
    }
    sections.push(userSection)
  }

  // 技术要求
  const techParts: string[] = []
  if (info.techStack?.length) {
    techParts.push(`技术栈: ${info.techStack.join('、')}`)
  }
  if (info.platforms?.length) {
    techParts.push(`平台: ${info.platforms.join('、')}`)
  }
  if (info.integrations?.length) {
    techParts.push(`集成需求: ${info.integrations.join('、')}`)
  }
  if (techParts.length > 0) {
    sections.push(`## 技术要求\n${techParts.join('\n')}`)
  }

  // 非功能需求
  const nfrParts: string[] = []
  if (info.nonFunctionalRequirements?.performance) {
    nfrParts.push(`- 性能: ${info.nonFunctionalRequirements.performance}`)
  }
  if (info.nonFunctionalRequirements?.security) {
    nfrParts.push(`- 安全: ${info.nonFunctionalRequirements.security}`)
  }
  if (info.nonFunctionalRequirements?.scalability) {
    nfrParts.push(`- 扩展性: ${info.nonFunctionalRequirements.scalability}`)
  }
  if (info.nonFunctionalRequirements?.availability) {
    nfrParts.push(`- 可用性: ${info.nonFunctionalRequirements.availability}`)
  }
  if (nfrParts.length > 0) {
    sections.push(`## 非功能需求\n${nfrParts.join('\n')}`)
  }

  // 约束条件
  if (info.constraints?.length) {
    sections.push(`## 约束条件\n${info.constraints.map((c) => `- ${c}`).join('\n')}`)
  }

  // 时间与预算
  const timeBudgetParts: string[] = []
  if (info.timeline?.deadline) {
    timeBudgetParts.push(`期望上线时间: ${info.timeline.deadline}`)
  }
  if (info.timeline?.priority) {
    const priorityMap = { urgent: '紧急', normal: '正常', flexible: '灵活' }
    timeBudgetParts.push(`优先级: ${priorityMap[info.timeline.priority] || info.timeline.priority}`)
  }
  if (info.budget) {
    timeBudgetParts.push(`预算范围: ${info.budget}`)
  }
  if (timeBudgetParts.length > 0) {
    sections.push(`## 时间与预算\n${timeBudgetParts.join('\n')}`)
  }

  return sections.join('\n\n')
}
