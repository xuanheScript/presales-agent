import type { ElicitationCollectedInfo } from '@/types'

/**
 * 获取已填充字段的摘要（用于提示词）
 */
export function getCollectedInfoSummary(info: ElicitationCollectedInfo): string {
  const parts: string[] = []

  if (info.projectType) {
    parts.push(`- 项目类型: ${info.projectType}`)
  }
  if (info.projectSummary) {
    parts.push(`- 项目概述: ${info.projectSummary}`)
  }
  if (info.businessGoals?.length) {
    parts.push(`- 业务目标: ${info.businessGoals.join('、')}`)
  }
  if (info.keyFeatures?.length) {
    parts.push(`- 核心功能: ${info.keyFeatures.join('、')}`)
  }
  if (info.outOfScope?.length) {
    parts.push(`- 不包含范围: ${info.outOfScope.join('、')}`)
  }
  if (info.targetUsers?.length) {
    parts.push(`- 目标用户: ${info.targetUsers.join('、')}`)
  }
  if (info.userVolume) {
    parts.push(`- 用户规模: ${info.userVolume}`)
  }
  if (info.useCases?.length) {
    parts.push(`- 使用场景: ${info.useCases.join('、')}`)
  }
  if (info.techStack?.length) {
    parts.push(`- 技术栈: ${info.techStack.join('、')}`)
  }
  if (info.platforms?.length) {
    parts.push(`- 平台: ${info.platforms.join('、')}`)
  }
  if (info.integrations?.length) {
    parts.push(`- 第三方集成: ${info.integrations.join('、')}`)
  }
  if (info.nonFunctionalRequirements) {
    const nfr = info.nonFunctionalRequirements
    if (nfr.performance) parts.push(`- 性能要求: ${nfr.performance}`)
    if (nfr.security) parts.push(`- 安全要求: ${nfr.security}`)
    if (nfr.scalability) parts.push(`- 扩展性要求: ${nfr.scalability}`)
    if (nfr.availability) parts.push(`- 可用性要求: ${nfr.availability}`)
  }
  if (info.constraints?.length) {
    parts.push(`- 约束条件: ${info.constraints.join('、')}`)
  }
  if (info.risks?.length) {
    parts.push(`- 潜在风险: ${info.risks.join('、')}`)
  }
  if (info.timeline) {
    if (info.timeline.deadline) parts.push(`- 期望上线时间: ${info.timeline.deadline}`)
    if (info.timeline.priority) parts.push(`- 优先级: ${info.timeline.priority}`)
  }
  if (info.budget) {
    parts.push(`- 预算范围: ${info.budget}`)
  }

  return parts.length > 0 ? parts.join('\n') : '暂无收集到的信息'
}

/**
 * 检查已收集信息的完整程度（供 AI 参考，不作为硬性限制）
 */
export function getCollectedFieldsCount(info: ElicitationCollectedInfo): {
  filled: string[]
  total: number
} {
  const allFields = [
    'projectType',
    'projectSummary',
    'businessGoals',
    'keyFeatures',
    'targetUsers',
    'techStack',
    'platforms',
    'nonFunctionalRequirements',
    'timeline',
  ]

  const filled: string[] = []

  if (info.projectType) filled.push('projectType')
  if (info.projectSummary) filled.push('projectSummary')
  if (info.businessGoals?.length) filled.push('businessGoals')
  if (info.keyFeatures?.length) filled.push('keyFeatures')
  if (info.targetUsers?.length) filled.push('targetUsers')
  if (info.techStack?.length) filled.push('techStack')
  if (info.platforms?.length) filled.push('platforms')
  if (info.nonFunctionalRequirements) {
    const nfr = info.nonFunctionalRequirements
    if (nfr.performance || nfr.security || nfr.scalability || nfr.availability) {
      filled.push('nonFunctionalRequirements')
    }
  }
  if (info.timeline?.deadline || info.timeline?.priority) filled.push('timeline')

  return {
    filled,
    total: allFields.length,
  }
}
