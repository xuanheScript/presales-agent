import { generateText, Output } from 'ai'
import { z } from 'zod'
import { defaultModel } from '@/lib/ai/config'
import { DIFFICULTY_MULTIPLIERS } from '@/constants'
import { createTelemetryConfig } from '@/lib/observability/langfuse'
import type { PresalesState, AgentEffortEstimation } from '../state'

/**
 * 工时评估结果 Schema
 *
 * 注意：总工时由代码根据功能模块计算，AI 只负责返回各阶段的比例分配
 */
const effortEstimationSchema = z.object({
  breakdownRatio: z.object({
    development: z.number().describe('开发工时占比（0-1之间的小数，如0.6表示60%）'),
    testing: z.number().describe('测试工时占比（0-1之间的小数）'),
    integration: z.number().describe('集成联调工时占比（0-1之间的小数）'),
  }).describe('各阶段工时比例，三者之和应为1'),
  teamComposition: z.array(
    z.object({
      role: z.string().describe('角色，如：前端开发、后端开发、测试工程师'),
      count: z.number().describe('人数'),
      duration: z.number().describe('参与周期（天）'),
    })
  ),
})

/**
 * 工时评估提示词
 */
const ESTIMATION_PROMPT = `你是一位经验丰富的项目经理，擅长根据功能模块评估项目工时和人员配置。

根据以下功能模块清单、项目信息和原始需求，生成详细的工时评估和人员配置建议。

**评估原则**：

注意：总工时已由系统根据功能模块自动计算（难度加权工时：{weightedHours}小时），你只需要评估各阶段的**工时比例**。

1. **开发工时占比**：通常占 50%-70%，根据项目复杂度调整
2. **测试工时占比**：根据项目特性自主判断，考虑以下因素：
   - 项目类型（金融、医疗等高安全性项目需要更多测试，可能占 25%-35%）
   - 业务逻辑复杂度
   - 数据准确性要求
   - 用户交互复杂度
   - 第三方系统集成数量
3. **集成联调工时占比**：根据项目架构自主判断，考虑以下因素：
   - 系统架构复杂度（微服务 vs 单体）
   - 模块间依赖关系
   - 外部系统对接数量
   - 数据同步和一致性要求
4. **三个比例之和必须等于 1**（如：开发0.6 + 测试0.25 + 集成0.15 = 1）

**人员配置原则**：
1. 根据技术栈确定所需角色
2. 考虑功能间的并行度
3. 合理分配工作量，避免过度加班

---

**项目描述**：

{projectDescription}

---

**原始需求文档**：

{rawRequirement}

---

**基础工时统计**：
- 功能模块数量：{moduleCount}
- 基础工时合计：{baseHours} 小时
- 难度加权工时：{weightedHours} 小时

**功能模块详情**：
{modules}

**项目信息**：
- 项目类型：{projectType}
- 技术栈：{techStack}
- 非功能性需求：{nonFunctionalRequirements}

---

请根据项目的实际情况，评估各阶段工时的合理比例（三个比例之和必须为1），并给出团队配置建议。`

/**
 * 工时评估节点
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

  try {
    // 计算基础工时和加权工时
    let baseHours = 0
    let weightedHours = 0

    for (const fn of state.functions) {
      baseHours += fn.estimatedHours
      const multiplier = DIFFICULTY_MULTIPLIERS[fn.difficultyLevel] || 1
      weightedHours += fn.estimatedHours * multiplier
    }

    // 构建功能模块描述
    const modulesDescription = state.functions
      .map(
        (fn, index) =>
          `${index + 1}. ${fn.moduleName} - ${fn.functionName}
         难度: ${fn.difficultyLevel}, 基础工时: ${fn.estimatedHours}h
         描述: ${fn.description}`
      )
      .join('\n\n')

    // 构建非功能性需求描述
    const nfr = state.analysis.nonFunctionalRequirements
    const nfrDescription = [
      nfr.performance ? `性能要求: ${nfr.performance}` : null,
      nfr.security ? `安全要求: ${nfr.security}` : null,
      nfr.scalability ? `扩展性要求: ${nfr.scalability}` : null,
    ].filter(Boolean).join('; ') || '无特殊要求'

    // 构建提示词
    const prompt = ESTIMATION_PROMPT
      .replace('{projectDescription}', state.projectDescription || '未提供项目描述')
      .replace('{rawRequirement}', state.rawRequirement)
      .replace('{moduleCount}', String(state.functions.length))
      .replace('{baseHours}', String(baseHours))
      .replace('{weightedHours}', String(Math.round(weightedHours)))
      .replace('{modules}', modulesDescription)
      .replace('{projectType}', state.analysis.projectType)
      .replace('{techStack}', state.analysis.techStack.join(', '))
      .replace('{nonFunctionalRequirements}', nfrDescription)

    // 调用 AI 模型进行评估
    const { output } = await generateText({
      model: defaultModel,
      output: Output.object({
        schema: effortEstimationSchema,
      }),
      prompt,
      experimental_telemetry: createTelemetryConfig('workflow-estimate', {
        projectId: state.projectId,
        requirementId: state.requirementId,
        modulesCount: state.functions.length,
        weightedHours,
      }),
    })

    // 验证输出
    if (!output) {
      return {
        error: '工时评估未返回有效结果',
        currentStep: 'estimate',
      }
    }

    // 验证比例之和是否为1（允许小误差）
    const ratioSum = output.breakdownRatio.development + output.breakdownRatio.testing + output.breakdownRatio.integration
    if (Math.abs(ratioSum - 1) > 0.01) {
      console.warn('[Agent] 工时比例之和不为1，进行归一化处理:', ratioSum)
    }

    // 归一化比例（确保和为1）
    const normalizedRatio = {
      development: output.breakdownRatio.development / ratioSum,
      testing: output.breakdownRatio.testing / ratioSum,
      integration: output.breakdownRatio.integration / ratioSum,
    }

    // 转换为 AgentEffortEstimation 类型
    const estimation: AgentEffortEstimation = {
      breakdownRatio: normalizedRatio,
      teamComposition: output.teamComposition.map((t) => ({
        role: t.role,
        count: t.count,
        duration: t.duration,
      })),
    }

    console.log('[Agent] 工时评估完成:', {
      breakdownRatio: estimation.breakdownRatio,
      teamSize: estimation.teamComposition.reduce((sum, t) => sum + t.count, 0),
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
