import { generateText, Output, stepCountIs } from 'ai'
import { z } from 'zod'
import { defaultModel } from '@/lib/ai/config'
import { createGitToolContext, createGitTools } from '@/lib/git/tools'
import { createTelemetryConfig } from '@/lib/observability/langfuse'
import { INDUSTRIES } from '@/constants'

export const maxDuration = 120 // 增加超时，因为可能有多轮工具调用

/**
 * 项目信息 Schema
 */
const projectInfoSchema = z.object({
  name: z.string().describe('项目名称，简洁明了，中文'),
  industry: z.enum(INDUSTRIES as unknown as [string, ...string[]]).describe('所属行业'),
  description: z.string().describe('项目描述，100-300字，中文，描述项目的主要功能和目标'),
})

/**
 * 解析 Git 仓库并使用 AI 生成项目信息
 *
 * 新版本使用 Tool Call 模式，让 AI 自主决定读取哪些文件
 *
 * POST /api/parse-git-repo
 * Body: { url: string, token?: string, branch?: string }
 */
export async function POST(req: Request) {
  try {
    const { url, token, branch } = await req.json()

    if (!url || typeof url !== 'string') {
      return Response.json(
        { success: false, error: '请提供有效的 Git 仓库地址' },
        { status: 400 }
      )
    }

    console.log('[ParseGitRepo] 开始解析仓库:', url, token ? '(带 Token)' : '', branch ? `(分支: ${branch})` : '')

    // 创建工具上下文
    const toolContext = createGitToolContext(url, token, branch)

    if (!toolContext) {
      return Response.json(
        { success: false, error: '无法解析 Git 仓库地址，请检查 URL 格式是否正确' },
        { status: 400 }
      )
    }

    // 创建 Git 访问工具集
    const gitTools = createGitTools(toolContext)

    console.log('[ParseGitRepo] 开始 AI 分析（Tool Call 模式）...')

    // 第一步：让 AI 探索仓库并收集信息
    const explorationResult = await generateText({
      model: defaultModel,
      tools: gitTools,
      stopWhen: stepCountIs(10), // 最多 10 轮工具调用
      experimental_telemetry: createTelemetryConfig('git-repo-exploration', {
        url,
        platform: toolContext.parsed.platform,
      }),
      system: `你是一位专业的项目分析师，正在分析一个 Git 仓库以了解项目信息。

你的任务是通过调用工具来探索仓库，收集足够的信息来理解：
1. 项目的主要功能和用途
2. 项目使用的技术栈
3. 项目所属的行业领域

探索策略：
1. 首先调用 getRepoInfo 获取仓库基本信息
2. 调用 getRepoTree 查看根目录结构，了解项目类型
3. 根据项目类型读取关键文件：
   - Node.js 项目：读取 package.json
   - Java 项目：读取 pom.xml 或 build.gradle
   - Python 项目：读取 requirements.txt 或 setup.py
   - 所有项目：尝试读取 README.md
4. 如果需要更多信息，可以读取 src 目录结构或其他配置文件

注意：
- 每个文件只读取一次
- 优先读取能快速了解项目的文件
- 收集到足够信息后停止探索`,
      prompt: `请分析这个 Git 仓库：${url}

使用提供的工具探索仓库结构和内容，收集项目信息。完成探索后，总结你发现的信息。`,
    })

    // 从所有步骤中收集完整的探索信息
    const steps = explorationResult.steps || []
    const toolCallCount = steps.reduce(
      (count, step) => count + (step.toolCalls?.length || 0),
      0
    )

    // 构建完整的探索内容，包含所有工具调用结果和 AI 分析
    const explorationParts: string[] = []
    for (const step of steps) {
      // 添加工具调用结果
      if (step.toolResults && step.toolResults.length > 0) {
        for (const toolResult of step.toolResults) {
          explorationParts.push(`### 工具: ${toolResult.toolName}\n${typeof toolResult.output === 'string' ? toolResult.output : JSON.stringify(toolResult.output, null, 2)}`)
        }
      }
      // 添加该步骤的 AI 分析文本
      if (step.text) {
        explorationParts.push(`### AI 分析\n${step.text}`)
      }
    }
    const explorationText = explorationParts.join('\n\n')

    console.log('[ParseGitRepo] 探索完成，工具调用次数:', toolCallCount, '，收集内容长度:', explorationText.length)

    if (toolCallCount === 0) {
      return Response.json(
        {
          success: false,
          error: '无法访问仓库，请确认仓库地址正确且有访问权限。如为私有仓库，请提供 Access Token',
        },
        { status: 400 }
      )
    }

    // 第二步：基于收集的信息生成结构化项目信息
    console.log('[ParseGitRepo] 生成项目信息...')

    const { output: projectInfo } = await generateText({
      model: defaultModel,
      output: Output.object({
        schema: projectInfoSchema,
      }),
      experimental_telemetry: createTelemetryConfig('git-repo-generate-info', {
        url,
        platform: toolContext.parsed.platform,
        toolCallCount,
      }),
      prompt: `你是一位专业的项目经理，请根据以下仓库分析结果，生成适合用于成本估算的项目基本信息。

## 仓库分析结果

${explorationText}

## 要求

请生成：
1. 项目名称：根据仓库内容生成一个简洁明了的中文项目名称，体现项目核心功能
2. 所属行业：从以下选项中选择最匹配的行业：${INDUSTRIES.join('、')}
3. 项目描述：用100-300字中文描述项目的主要功能、目标用户和技术特点

注意：
- 项目名称应该体现项目的核心功能，不要直接使用英文仓库名
- 行业选择要准确，如果不确定可以选择"其他"
- 描述要具体，包含技术栈、主要功能等信息`,
    })

    if (!projectInfo) {
      return Response.json(
        { success: false, error: 'AI 分析未返回有效结果' },
        { status: 500 }
      )
    }

    console.log('[ParseGitRepo] AI 分析完成:', projectInfo)

    // 尝试从探索结果中提取仓库基本信息
    const repoInfo = {
      platform: toolContext.parsed.platform,
      name: toolContext.parsed.repo,
      language: null as string | null,
      stars: 0,
    }

    return Response.json({
      success: true,
      data: projectInfo,
      repoInfo,
      debug: {
        toolCallCount,
        explorationSummary: explorationText.slice(0, 500),
      },
    })
  } catch (error) {
    console.error('[ParseGitRepo] 解析失败:', error)

    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '解析仓库失败，请稍后重试',
      },
      { status: 500 }
    )
  }
}
