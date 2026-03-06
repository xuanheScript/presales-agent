import { generateText, Output, stepCountIs } from 'ai'
import { z } from 'zod'
import { defaultModel } from '@/lib/ai/config'
import { createGitToolContext, createGitTools } from '@/lib/git/tools'
import { estimateExplorationBudget } from '@/lib/git/prescan'
import { createTelemetryConfig } from '@/lib/observability/langfuse'
import { getFunctionCategoryNames } from '@/app/actions/function-categories'

export const maxDuration = 180

const functionExtractionSchema = z.object({
  functions: z.array(z.object({
    function_name: z.string().describe('功能名称，简洁明了，中文，如"用户注册与登录"'),
    category: z.string().describe('功能分类，从可用分类中选择最匹配的'),
    description: z.string().describe('功能描述，50-150字，中文，描述该功能的主要能力和业务价值'),
    standard_hours: z.number().describe('标准工时（小时），根据代码复杂度和业务逻辑评估'),
  })),
  groups: z.array(z.object({
    name: z.string().describe('功能组名称，中文'),
    description: z.string().describe('功能组描述，说明这组功能的整体用途'),
    function_names: z.array(z.string()).describe('该组包含的功能名称列表，引用 functions 中的 function_name'),
  })),
})

/**
 * 工具调用的中文描述
 */
function describeToolCall(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'getRepoInfo':
      return '获取仓库基本信息'
    case 'getRepoTree': {
      const path = args.path as string | undefined
      return path ? `查看目录 ${path}` : '查看项目根目录结构'
    }
    case 'readFile':
      return `读取文件 ${args.path}`
    case 'searchFiles':
      return `搜索文件 ${args.filename}`
    default:
      return `调用 ${toolName}`
  }
}

/**
 * 使用 SSE 流式推送分析进度
 *
 * POST /api/parse-git-functions
 * Body: { url: string, token?: string, branch?: string }
 *
 * 事件格式:
 * - { type: 'progress', message: string }  进度更新
 * - { type: 'result', success: true, data: {...} }  最终结果
 * - { type: 'error', error: string }  错误
 */
export async function POST(req: Request) {
  const { url, token, branch } = await req.json()

  if (!url || typeof url !== 'string') {
    return Response.json(
      { success: false, error: '请提供有效的 Git 仓库地址' },
      { status: 400 }
    )
  }

  const toolContext = createGitToolContext(url, token, branch)

  if (!toolContext) {
    return Response.json(
      { success: false, error: '无法解析 Git 仓库地址，请检查 URL 格式是否正确' },
      { status: 400 }
    )
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        send({ type: 'progress', message: '正在连接仓库...' })

        // 预扫描仓库规模（估算值），动态决定探索步数
        const prescan = await estimateExplorationBudget(toolContext)
        const { maxSteps, confidence, partial, reason, metrics, compressedTreeCsv } = prescan
        const confidenceLabel = confidence === 'high' ? '高' : confidence === 'medium' ? '中' : '低'
        const partialText = partial ? '（部分扫描）' : ''
        send({
          type: 'progress',
          message: `仓库预扫描完成${partialText}：估算约 ${metrics.fileCountEstimate} 个文件、${metrics.dirCountEstimate} 个目录（深度约 ${metrics.maxDepthEstimate}，置信度${confidenceLabel}），预计探索 ${maxSteps} 步`,
        })

        const gitTools = createGitTools(toolContext)

        // 第一步：AI 探索仓库，通过 onStepFinish 推送实时进度
        const explorationResult = await generateText({
          model: defaultModel,
          tools: gitTools,
          stopWhen: stepCountIs(maxSteps),
          experimental_telemetry: createTelemetryConfig('git-function-exploration', {
            url,
            platform: toolContext.parsed.platform,
            maxSteps,
            prescanConfidence: confidence,
            prescanPartial: partial,
          }),
          onStepFinish: ({ toolCalls, text }) => {
            // 推送每一次工具调用
            if (toolCalls && toolCalls.length > 0) {
              for (const tc of toolCalls) {
                // onStepFinish 中工具调用参数在 input 字段
                const input = ('input' in tc ? tc.input : {}) as Record<string, unknown>
                send({
                  type: 'progress',
                  message: describeToolCall(tc.toolName, input),
                  tool: tc.toolName,
                })
              }
            }
            // 推送 AI 的中间分析文本
            if (text) {
              const summary = text.length > 100 ? text.slice(0, 100) + '...' : text
              send({ type: 'thinking', message: summary })
            }
          },
          system: `你是一位资深的软件架构师和售前估算专家，正在分析一个 Git 仓库以提取业务功能模块。

你的任务是通过调用工具来深入探索仓库，从**业务功能**角度理解项目包含哪些功能模块。

探索策略：
1. 首先调用 getRepoInfo 获取仓库基本信息
2. 优先使用提示词中提供的 CSV 目录结构，先定位核心业务目录和关键文件路径
3. 读取 README.md 了解项目功能概述
4. 根据项目类型读取关键配置文件（package.json、pom.xml 等）
5. 按业务域深入探索核心代码目录结构
6. 选择性读取关键业务代码文件，了解具体功能实现
7. 需要补充路径信息时再调用 getRepoTree 或 searchFiles

注意：
- 优先读取能快速了解业务功能的文件
- 不要关注基础设施代码（构建脚本、CI/CD 等）
- 尽量跳过噪声目录或静态资源（如 node_modules、dist、build、coverage、public/assets）
- 收集到足够信息后停止探索`,
          prompt: `请分析这个 Git 仓库：${url}

仓库预扫描（${partial ? '估算（部分扫描）' : '统计（完整结构）'}）：约 ${metrics.fileCountEstimate} 个文件、${metrics.dirCountEstimate} 个目录、最大深度约 ${metrics.maxDepthEstimate} 层；置信度 ${confidence}；探索步数上限 ${maxSteps} 步。
${partial ? `注意：本次预扫描为部分结果（原因：${reason}），你应优先补充关键目录信息再收敛总结。` : '预扫描质量较稳定，可按当前步数预算优先覆盖核心业务目录。'}
${maxSteps <= 12 ? '这是一个小型项目，快速浏览核心目录和关键文件即可。' : maxSteps <= 20 ? '这是一个中型项目，重点探索核心业务目录和关键代码文件。' : '这是一个大型项目，需要系统性地探索各业务模块，注意合理分配步数覆盖主要功能领域。'}

以下是仓库目录结构（CSV 语义压缩，完整结构）：
- t: D=目录, F=文件, S=子模块
- d: 深度
- p: 路径
--- CSV START ---
${compressedTreeCsv}
--- CSV END ---

请基于以上目录结构优先判断核心业务目录，再调用工具读取关键文件内容。
跳过 node_modules、dist、build、coverage、public/assets 等低业务价值路径。
使用提供的工具深入探索仓库的代码结构和业务逻辑，从业务功能角度收集信息。完成探索后，总结你发现的所有业务功能模块。`,
        })

        // 收集探索信息
        const steps = explorationResult.steps || []
        const toolCallCount = steps.reduce(
          (count, step) => count + (step.toolCalls?.length || 0),
          0
        )

        const explorationParts: string[] = []
        for (const step of steps) {
          if (step.toolResults && step.toolResults.length > 0) {
            for (const toolResult of step.toolResults) {
              explorationParts.push(`### 工具: ${toolResult.toolName}\n${typeof toolResult.output === 'string' ? toolResult.output : JSON.stringify(toolResult.output, null, 2)}`)
            }
          }
          if (step.text) {
            explorationParts.push(`### AI 分析\n${step.text}`)
          }
        }
        const explorationText = explorationParts.join('\n\n')

        console.log('[ParseGitFunctions] 探索完成，工具调用次数:', toolCallCount, '，内容长度:', explorationText.length)

        if (toolCallCount === 0) {
          send({
            type: 'error',
            error: '无法访问仓库，请确认仓库地址正确且有访问权限。如为私有仓库，请提供 Access Token',
          })
          controller.close()
          return
        }

        // 第二步：生成结构化功能列表
        send({ type: 'progress', message: '正在生成功能列表和工时评估...' })

        // 动态获取分类列表
        const categoryNames = await getFunctionCategoryNames()

        const { output: result } = await generateText({
          model: defaultModel,
          output: Output.object({
            schema: functionExtractionSchema,
          }),
          experimental_telemetry: createTelemetryConfig('git-function-extraction', {
            url,
            platform: toolContext.parsed.platform,
            toolCallCount,
          }),
          prompt: `你是一位资深的售前估算专家，请根据以下仓库分析结果，提取所有业务功能模块。

## 仓库分析结果

${explorationText}

## 功能分类说明

可用的分类有：${categoryNames.join('、')}
优先使用上述分类；如果确实无法准确归类，允许新增分类（中文、简洁、具备业务语义），并确保命名稳定可复用。

## 要求

请提取该项目中的所有业务功能模块，对于每个功能：

1. **function_name**：简洁的中文功能名称，体现核心能力（如"用户注册与登录"、"商品管理"、"订单流程"）
2. **category**：优先从上述分类中选择；若都不匹配，可新增一个最贴切的业务分类
3. **description**：50-150字中文描述，说明该功能的主要能力、包含的子功能、业务价值
4. **standard_hours**：根据代码复杂度评估标准开发工时（小时）

同时将相关功能组织成功能组：
1. **name**：功能组名称，如"用户体系"、"交易系统"
2. **description**：说明这组功能的整体用途
3. **function_names**：该组包含的功能名称列表（必须引用你定义的 function_name）

注意：
- 从业务角度提取功能，不要提取技术基础设施（如代码构建、部署配置）
- 功能粒度适中，不要太粗也不要太细
- 功能组应该有实际的业务意义，将密切相关的功能归为一组
- 确保每个功能至少属于一个功能组`,
        })

        if (!result) {
          send({ type: 'error', error: 'AI 分析未返回有效结果' })
          controller.close()
          return
        }

        console.log('[ParseGitFunctions] 提取完成:', {
          functionCount: result.functions.length,
          groupCount: result.groups.length,
        })

        send({ type: 'result', success: true, data: result })
        controller.close()
      } catch (error) {
        console.error('[ParseGitFunctions] 分析失败:', error)
        send({
          type: 'error',
          error: error instanceof Error ? error.message : '分析仓库失败，请稍后重试',
        })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
