import { generateText, Output } from 'ai'
import { z } from 'zod'
import type { RunnableConfig } from '@langchain/core/runnables'
import { defaultModelGateway, type ModelGateway } from '@/lib/ai/model-gateway'
import {
  EXECUTION_POLICY,
  getRunnableSignal,
  isAbortError,
  withAbortSignal,
} from '../execution-policy'
import { getActiveTemplate } from '@/app/actions/templates'
import { createAdminClient } from '@/lib/supabase/admin'
import { findActiveTemplateWithClient } from '@/lib/templates/active-template'
import { createTelemetryConfig } from '@/lib/observability/langfuse'
import type { PresalesState, AgentAnalysisResult } from '../state'

/**
 * 需求分析结果 Schema
 */
const requirementAnalysisSchema = z.object({
  projectType: z.string().describe('项目类型，如：电商平台、管理系统、移动应用等'),
  businessGoals: z.array(z.string()).describe('业务目标列表'),
  keyFeatures: z.array(z.string()).describe('核心功能需求列表'),
  techStack: z.array(z.string()).describe('建议的技术栈'),
  nonFunctionalRequirements: z.object({
    performance: z.string().optional().describe('性能要求'),
    security: z.string().optional().describe('安全要求'),
    scalability: z.string().optional().describe('扩展性要求'),
  }).describe('非功能性需求'),
  risks: z.array(z.string()).describe('潜在风险列表'),
})

/**
 * 默认需求分析提示词（当数据库没有模板时使用）
 */
const DEFAULT_ANALYSIS_PROMPT = `你是一位经验丰富的售前技术顾问，擅长分析客户需求并提取关键信息。

请仔细分析以下需求文档，提取并结构化以下信息：

1. **项目类型**：判断这是什么类型的项目（如电商平台、企业管理系统、移动应用等）

2. **业务目标**：客户希望通过这个项目达成什么业务目标

3. **核心功能**：列出所有明确提及的功能需求

4. **技术栈**：根据需求特点推荐合适的技术栈

5. **非功能性需求**：
   - 性能要求（响应时间、并发量等）
   - 安全要求（数据安全、权限控制等）
   - 扩展性要求（未来扩展方向）

6. **潜在风险**：识别项目可能面临的风险

---

**项目描述**：

{项目描述}

---

**需求文档内容**：

{需求内容}

---

请以结构化的 JSON 格式返回分析结果。`

export interface AnalysisPromptSnapshot {
  content: string
  version: string
}

type ActiveAnalysisTemplateReader = (
  industry?: string
) => ReturnType<typeof getActiveTemplate>

async function createAnalysisPromptSnapshot(
  readActiveTemplate: ActiveAnalysisTemplateReader,
  industry?: string | null
): Promise<AnalysisPromptSnapshot> {
  try {
    const template = await readActiveTemplate(industry || undefined)
    if (template?.prompt_content) {
      console.log('[Agent] 使用数据库模板:', template.template_name)
      return {
        content: template.prompt_content,
        version: `template:${template.id}:${template.version}`,
      }
    }
  } catch (error) {
    console.warn('[Agent] 获取模板失败，使用默认模板:', error)
  }

  return {
    content: DEFAULT_ANALYSIS_PROMPT,
    version: 'requirement-analysis-default-v1',
  }
}

/**
 * 固定本次请求执行使用的需求分析提示词。
 */
export async function getAnalysisPromptSnapshot(
  industry?: string | null
): Promise<AnalysisPromptSnapshot> {
  return createAnalysisPromptSnapshot(
    (templateIndustry) => getActiveTemplate(
      'requirement_analysis',
      templateIndustry
    ),
    industry
  )
}

/**
 * 固定后台执行使用的需求分析提示词，不依赖 Next.js 请求上下文。
 */
export async function getAnalysisPromptSnapshotForWorker(
  industry?: string | null
): Promise<AnalysisPromptSnapshot> {
  const supabase = createAdminClient()
  return createAnalysisPromptSnapshot(
    (templateIndustry) => findActiveTemplateWithClient(
      supabase,
      'requirement_analysis',
      templateIndustry
    ),
    industry
  )
}

/**
 * 需求分析节点
 *
 * 使用 AI SDK 的 generateText + Output.object 进行结构化输出
 */
export async function analyzeNode(
  state: PresalesState,
  config?: RunnableConfig,
  modelGateway: ModelGateway = defaultModelGateway
): Promise<Partial<PresalesState>> {
  // 验证输入
  if (!state.canonicalRequirement || state.canonicalRequirement.trim() === '') {
    return {
      error: '需求内容不能为空',
      currentStep: 'analyze',
    }
  }

  try {
    const promptTemplate = state.analysisPromptTemplate
    if (!promptTemplate) {
      return {
        error: '执行缺少固定的需求分析提示词快照',
        currentStep: 'analyze',
      }
    }

    // 替换模板变量
    const prompt = promptTemplate
      .replace('{项目描述}', state.projectDescription || '未提供项目描述')
      .replace('{需求内容}', state.canonicalRequirement)
      .replace('{requirement}', state.canonicalRequirement)
      .replace('{projectDescription}', state.projectDescription || '未提供项目描述')

    // 调用 AI 模型进行分析
    const { output } = await withAbortSignal(
      [getRunnableSignal(config)],
      EXECUTION_POLICY.workflowNodeTimeoutMs,
      (signal) => generateText({
        model: modelGateway.model,
        output: Output.object({
          schema: requirementAnalysisSchema,
        }),
        prompt,
        abortSignal: signal,
        maxRetries: modelGateway.maxRetries,
        providerOptions: modelGateway.profile.providerOptions,
        experimental_telemetry: createTelemetryConfig('workflow-analyze', {
          projectId: state.projectId,
          requirementBaselineId: state.requirementBaselineId,
          executionId: String(config?.configurable?.executionId || 'none'),
        }),
      })
    )

    // 验证输出
    if (!output) {
      return {
        error: '需求分析未返回有效结果',
        currentStep: 'analyze',
      }
    }

    // 转换为 AgentAnalysisResult 类型
    const analysis: AgentAnalysisResult = {
      projectType: output.projectType,
      businessGoals: output.businessGoals,
      keyFeatures: output.keyFeatures,
      techStack: output.techStack,
      nonFunctionalRequirements: {
        performance: output.nonFunctionalRequirements.performance,
        security: output.nonFunctionalRequirements.security,
        scalability: output.nonFunctionalRequirements.scalability,
      },
      risks: output.risks,
    }

    console.log('[Agent] 需求分析完成:', {
      projectType: analysis.projectType,
      featuresCount: analysis.keyFeatures.length,
      risksCount: analysis.risks.length,
    })

    return {
      analysis,
      currentStep: 'breakdown',
      error: null,
    }
  } catch (error) {
    if (isAbortError(error, getRunnableSignal(config))) {
      throw error
    }

    console.error('[Agent] 需求分析失败:', error)

    return {
      error: `需求分析失败: ${error instanceof Error ? error.message : '未知错误'}`,
      currentStep: 'analyze',
    }
  }
}
