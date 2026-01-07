import { generateText, Output } from 'ai'
import { z } from 'zod'
import { defaultModel } from '@/lib/ai/config'
import { DIFFICULTY_MULTIPLIERS } from '@/constants'
import type { PresalesState, AgentEffortEstimation } from '../state'

/**
 * 工时评估结果 Schema
 */
const effortEstimationSchema = z.object({
  totalHours: z.number().describe('总工时（小时）'),
  breakdown: z.object({
    development: z.number().describe('开发工时'),
    testing: z.number().describe('测试工时'),
    integration: z.number().describe('集成联调工时'),
  }),
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

根据以下功能模块清单，生成详细的工时评估和人员配置建议。

**评估原则**：
1. 开发工时 = 各功能工时总和（已应用难度系数）
2. 测试工时 = 开发工时 × 30%
3. 集成联调 = 开发工时 × 15%
4. 总工时 = 开发 + 测试 + 集成

**人员配置原则**：
1. 根据技术栈确定所需角色
2. 考虑功能间的并行度
3. 合理分配工作量，避免过度加班

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

---

请生成工时评估结果，包括工时分解和团队配置建议。`

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

    // 构建提示词
    const prompt = ESTIMATION_PROMPT
      .replace('{moduleCount}', String(state.functions.length))
      .replace('{baseHours}', String(baseHours))
      .replace('{weightedHours}', String(Math.round(weightedHours)))
      .replace('{modules}', modulesDescription)
      .replace('{projectType}', state.analysis.projectType)
      .replace('{techStack}', state.analysis.techStack.join(', '))

    // 调用 AI 模型进行评估
    const { output } = await generateText({
      model: defaultModel,
      output: Output.object({
        schema: effortEstimationSchema,
      }),
      prompt,
    })

    // 验证输出
    if (!output) {
      return {
        error: '工时评估未返回有效结果',
        currentStep: 'estimate',
      }
    }

    // 转换为 AgentEffortEstimation 类型
    const estimation: AgentEffortEstimation = {
      totalHours: output.totalHours,
      breakdown: {
        development: output.breakdown.development,
        testing: output.breakdown.testing,
        integration: output.breakdown.integration,
      },
      teamComposition: output.teamComposition.map((t) => ({
        role: t.role,
        count: t.count,
        duration: t.duration,
      })),
    }

    console.log('[Agent] 工时评估完成:', {
      totalHours: estimation.totalHours,
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
