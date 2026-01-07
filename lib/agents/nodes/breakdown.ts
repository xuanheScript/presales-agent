import { generateText, Output } from 'ai'
import { z } from 'zod'
import { defaultModel } from '@/lib/ai/config'
import type { PresalesState, AgentFunctionModule } from '../state'

/**
 * 功能模块输出 Schema
 */
const functionModulesSchema = z.object({
  modules: z.array(
    z.object({
      moduleName: z.string().describe('模块名称，如：用户管理、订单系统'),
      functionName: z.string().describe('功能名称，如：用户注册、订单创建'),
      description: z.string().describe('功能描述'),
      difficultyLevel: z
        .enum(['simple', 'medium', 'complex', 'very_complex'])
        .describe('难度等级'),
      estimatedHours: z.number().describe('预估工时（小时）'),
      dependencies: z.array(z.string()).optional().describe('依赖的其他功能'),
    })
  ),
})

/**
 * 功能拆解提示词
 */
const BREAKDOWN_PROMPT = `你是一位资深的软件架构师，擅长将项目需求拆解为可执行的功能模块。

根据以下需求分析结果，将项目拆解为详细的功能模块清单。

**注意事项**：
1. 每个功能应该是一个独立可开发的单元
2. 根据项目实际情况合理估算工时
3. 难度等级说明：
   - simple: 简单功能，标准实现，约 4-8 小时
   - medium: 中等复杂度，需要一些定制，约 8-24 小时
   - complex: 复杂功能，需要深度定制，约 24-60 小时
   - very_complex: 非常复杂，需要创新解决方案，60+ 小时

---

**需求分析结果**：

项目类型：{projectType}

业务目标：
{businessGoals}

核心功能：
{keyFeatures}

技术栈：{techStack}

---

请生成完整的功能模块清单，包含每个功能的模块名称、功能名称、描述、难度等级和预估工时。`

/**
 * 功能拆解节点
 *
 * 使用 AI SDK 的 generateText + Output.object
 */
export async function breakdownNode(
  state: PresalesState
): Promise<Partial<PresalesState>> {
  // 验证前置条件
  if (!state.analysis) {
    return {
      error: '缺少需求分析结果，无法进行功能拆解',
      currentStep: 'breakdown',
    }
  }

  try {
    // 构建提示词
    const { analysis } = state
    const prompt = BREAKDOWN_PROMPT
      .replace('{projectType}', analysis.projectType)
      .replace('{businessGoals}', analysis.businessGoals.map((g) => `- ${g}`).join('\n'))
      .replace('{keyFeatures}', analysis.keyFeatures.map((f) => `- ${f}`).join('\n'))
      .replace('{techStack}', analysis.techStack.join(', '))

    // 调用 AI 模型进行功能拆解
    const { output } = await generateText({
      model: defaultModel,
      output: Output.object({
        schema: functionModulesSchema,
      }),
      prompt,
    })

    // 验证输出
    if (!output || !output.modules || output.modules.length === 0) {
      return {
        error: '功能拆解未返回有效结果',
        currentStep: 'breakdown',
      }
    }

    // 转换为 AgentFunctionModule 类型
    const functions: AgentFunctionModule[] = output.modules.map((m) => ({
      moduleName: m.moduleName,
      functionName: m.functionName,
      description: m.description,
      difficultyLevel: m.difficultyLevel,
      estimatedHours: m.estimatedHours,
      dependencies: m.dependencies,
    }))

    console.log('[Agent] 功能拆解完成:', {
      modulesCount: functions.length,
      totalHours: functions.reduce((sum, f) => sum + f.estimatedHours, 0),
    })

    return {
      functions,
      currentStep: 'estimate',
      error: null,
    }
  } catch (error) {
    console.error('[Agent] 功能拆解失败:', error)

    return {
      error: `功能拆解失败: ${error instanceof Error ? error.message : '未知错误'}`,
      currentStep: 'breakdown',
    }
  }
}
