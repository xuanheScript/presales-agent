import { generateText, Output } from 'ai'
import { z } from 'zod'
import { defaultModel } from '@/lib/ai/config'
import { createTelemetryConfig } from '@/lib/observability/langfuse'
import type { PresalesState, AgentEffortEstimation } from '../state'

/**
 * 缓冲系数评估 Schema
 *
 * 注意：工时已经在 breakdown 阶段按角色评估完成，这里只评估缓冲系数
 */
const bufferEstimationSchema = z.object({
  bufferCoefficient: z.number().min(1.0).max(2.5).describe('缓冲系数（1.2-2.0之间），根据项目风险程度确定'),
  bufferReason: z.string().describe('缓冲系数的评估依据说明'),
})

/**
 * 缓冲系数评估提示词
 */
const BUFFER_ESTIMATION_PROMPT = `你是一位经验丰富的项目经理，擅长评估项目风险和确定合理的工时缓冲。

根据以下项目信息，评估合理的缓冲系数。

**缓冲系数参考标准**：

| 缓冲系数 | 适用场景 |
|---------|---------|
| 1.2 | 常规功能，需求明确，团队熟悉技术栈 |
| 1.3 | 复杂功能，有一定不确定性，需要技术攻关 |
| 1.5 | 第三方对接较多，使用新技术，需求可能变更 |
| 2.0 | 探索性项目，需求不明确，技术方案未定 |

**风险评估因素**：
1. 需求明确程度
2. 技术栈熟悉度
3. 第三方系统对接复杂度
4. 团队协作复杂度
5. 行业合规要求（金融、医疗等需要更高缓冲）
6. 项目周期压力

---

**项目描述**：

{projectDescription}

---

**项目信息**：
- 项目类型：{projectType}
- 技术栈：{techStack}
- 风险因素：{risks}
- 非功能性需求：{nonFunctionalRequirements}

**工时统计**：
- 功能模块数量：{moduleCount}
- 识别的角色数量：{rolesCount}
- 功能模块总人天：{moduleTotalDays}
- 额外工作总人天：{additionalTotalDays}
- 基础总人天：{baseTotalDays}

---

请评估合理的缓冲系数（1.2-2.0之间），并说明评估依据。`

/**
 * 工时评估节点
 *
 * 新版本：工时已在 breakdown 阶段按角色评估完成
 * 这里主要做：
 * 1. 按角色汇总工时
 * 2. 评估缓冲系数
 */
export async function estimateNode(
  state: PresalesState
): Promise<Partial<PresalesState>> {
  // 验证前置条件
  if (!state.functions || state.functions.length === 0) {
    return {
      error: '缺少功能模块列表，无法进行工时评估',
      currentStep: 'estimate',
    }
  }

  if (!state.analysis) {
    return {
      error: '缺少需求分析结果，无法进行工时评估',
      currentStep: 'estimate',
    }
  }

  if (!state.identifiedRoles || state.identifiedRoles.length === 0) {
    return {
      error: '缺少角色识别结果，无法进行工时评估',
      currentStep: 'estimate',
    }
  }

  try {
    // 1. 按角色汇总功能模块工时
    const roleDaysMap = new Map<string, number>()

    for (const fn of state.functions) {
      for (const re of fn.roleEstimates) {
        const current = roleDaysMap.get(re.role) || 0
        roleDaysMap.set(re.role, current + re.days)
      }
    }

    // 2. 加入额外工作项的工时（按角色分配）
    for (const work of state.additionalWork) {
      // 额外工作项的工时平均分配给 assignedRoles
      const daysPerRole = work.days / work.assignedRoles.length
      for (const role of work.assignedRoles) {
        const current = roleDaysMap.get(role) || 0
        roleDaysMap.set(role, current + daysPerRole)
      }
    }

    // 3. 计算总人天
    const moduleTotalDays = state.functions.reduce(
      (sum, f) => sum + f.roleEstimates.reduce((s, r) => s + r.days, 0),
      0
    )
    const additionalTotalDays = state.additionalWork.reduce((sum, w) => sum + w.days, 0)
    const baseTotalDays = moduleTotalDays + additionalTotalDays

    // 4. 构建非功能性需求描述
    const nfr = state.analysis.nonFunctionalRequirements
    const nfrDescription = [
      nfr.performance ? `性能要求: ${nfr.performance}` : null,
      nfr.security ? `安全要求: ${nfr.security}` : null,
      nfr.scalability ? `扩展性要求: ${nfr.scalability}` : null,
    ].filter(Boolean).join('; ') || '无特殊要求'

    // 5. 构建提示词
    const prompt = BUFFER_ESTIMATION_PROMPT
      .replace('{projectDescription}', state.projectDescription || '未提供项目描述')
      .replace('{projectType}', state.analysis.projectType)
      .replace('{techStack}', state.analysis.techStack.join(', '))
      .replace('{risks}', state.analysis.risks.join(', ') || '无明显风险')
      .replace('{nonFunctionalRequirements}', nfrDescription)
      .replace('{moduleCount}', String(state.functions.length))
      .replace('{rolesCount}', String(state.identifiedRoles.length))
      .replace('{moduleTotalDays}', String(Math.round(moduleTotalDays * 10) / 10))
      .replace('{additionalTotalDays}', String(Math.round(additionalTotalDays * 10) / 10))
      .replace('{baseTotalDays}', String(Math.round(baseTotalDays * 10) / 10))

    // 6. 调用 AI 模型评估缓冲系数
    const { output } = await generateText({
      model: defaultModel,
      output: Output.object({
        schema: bufferEstimationSchema,
      }),
      prompt,
      experimental_telemetry: createTelemetryConfig('workflow-estimate', {
        projectId: state.projectId,
        requirementId: state.requirementId,
        modulesCount: state.functions.length,
        baseTotalDays,
      }),
    })

    // 验证输出
    if (!output) {
      return {
        error: '缓冲系数评估未返回有效结果',
        currentStep: 'estimate',
      }
    }

    // 7. 构建角色汇总（包含建议人数）
    const roleSummary = Array.from(roleDaysMap.entries()).map(([role, totalDays]) => {
      // 从 identifiedRoles 中获取建议人数
      const identifiedRole = state.identifiedRoles.find((r) => r.role === role)
      return {
        role,
        totalDays: Math.round(totalDays * 10) / 10,
        headcount: identifiedRole?.headcount || 1,
      }
    })

    // 8. 转换为 AgentEffortEstimation 类型
    const estimation: AgentEffortEstimation = {
      identifiedRoles: state.identifiedRoles,
      additionalWork: state.additionalWork,
      roleSummary,
      bufferCoefficient: output.bufferCoefficient,
      bufferReason: output.bufferReason,
    }

    console.log('[Agent] 工时评估完成:', {
      baseTotalDays,
      bufferCoefficient: output.bufferCoefficient,
      bufferedTotalDays: Math.round(baseTotalDays * output.bufferCoefficient * 10) / 10,
      rolesCount: roleSummary.length,
    })

    return {
      estimation,
      currentStep: 'calculate',
      error: null,
    }
  } catch (error) {
    console.error('[Agent] 工时评估失败:', error)

    return {
      error: `工时评估失败: ${error instanceof Error ? error.message : '未知错误'}`,
      currentStep: 'estimate',
    }
  }
}
