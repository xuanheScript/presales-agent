import { streamText, convertToModelMessages, type UIMessage } from 'ai'
import { defaultModel } from '@/lib/ai/config'
import { getProject } from '@/app/actions/projects'
import { getLatestRequirement } from '@/app/actions/requirements'
import { getFunctionModules } from '@/app/actions/functions'
import { getCostEstimate } from '@/app/actions/costs'

export const maxDuration = 60

interface ChatRequest {
  messages: UIMessage[]
  projectId: string
}

/**
 * POST /api/chat
 *
 * 对话式需求澄清 API
 * 支持与 Agent 进行多轮对话，补充和澄清需求细节
 */
export async function POST(req: Request) {
  try {
    const { messages, projectId }: ChatRequest = await req.json()

    if (!projectId) {
      return new Response(
        JSON.stringify({ error: '缺少项目 ID' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 获取项目上下文信息
    const [project, requirement, functions, costEstimate] = await Promise.all([
      getProject(projectId),
      getLatestRequirement(projectId),
      getFunctionModules(projectId),
      getCostEstimate(projectId),
    ])

    if (!project) {
      return new Response(
        JSON.stringify({ error: '项目不存在' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 构建系统提示词，包含项目上下文
    const systemPrompt = buildSystemPrompt(project, requirement, functions, costEstimate)

    // 将 UI 消息转换为模型消息格式
    const modelMessages = await convertToModelMessages(messages)

    // 使用 AI SDK 进行流式对话
    const result = streamText({
      model: defaultModel,
      system: systemPrompt,
      messages: modelMessages,
    })

    // AI SDK v6 使用 toUIMessageStreamResponse() 与 useChat 配合
    return result.toUIMessageStreamResponse()
  } catch (error) {
    console.error('[Chat API] 对话失败:', error)

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : '对话失败' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

/**
 * 构建系统提示词
 */
function buildSystemPrompt(
  project: Awaited<ReturnType<typeof getProject>>,
  requirement: Awaited<ReturnType<typeof getLatestRequirement>>,
  functions: Awaited<ReturnType<typeof getFunctionModules>>,
  costEstimate: Awaited<ReturnType<typeof getCostEstimate>>
): string {
  let contextInfo = `# 当前项目信息

**项目名称**：${project?.name || '未命名'}
**项目描述**：${project?.description || '无'}
**行业**：${project?.industry || '未指定'}
**状态**：${project?.status || 'draft'}
`

  // 添加需求信息
  if (requirement) {
    contextInfo += `
## 需求内容
${requirement.raw_content || '无'}
`

    if (requirement.parsed_content) {
      const parsed = requirement.parsed_content
      contextInfo += `
## AI 分析结果
- **项目类型**：${parsed.projectType}
- **业务目标**：${parsed.businessGoals.join('、') || '无'}
- **核心功能**：${parsed.keyFeatures.join('、') || '无'}
- **技术栈**：${parsed.techStack.join('、') || '无'}
- **潜在风险**：${parsed.risks.join('、') || '无'}
`
    }
  }

  // 添加功能模块信息
  if (functions && functions.length > 0) {
    const totalHours = functions.reduce((sum, f) => sum + f.estimated_hours, 0)
    contextInfo += `
## 功能模块（共 ${functions.length} 个，总工时 ${totalHours} 小时）
${functions.slice(0, 10).map(f => `- ${f.module_name} / ${f.function_name}：${f.estimated_hours}小时（${f.difficulty_level}）`).join('\n')}
${functions.length > 10 ? `\n... 还有 ${functions.length - 10} 个功能` : ''}
`
  }

  // 添加成本信息
  if (costEstimate) {
    contextInfo += `
## 成本估算
- **人力成本**：¥${costEstimate.labor_cost.toLocaleString()}
- **服务成本**：¥${costEstimate.service_cost.toLocaleString()}
- **基础设施成本**：¥${costEstimate.infrastructure_cost.toLocaleString()}
- **风险缓冲**：${costEstimate.buffer_percentage}%
- **总成本**：¥${costEstimate.total_cost.toLocaleString()}
`
  }

  return `你是一位资深的售前顾问和项目经理。你正在与客户进行需求澄清对话，帮助他们完善项目需求。

${contextInfo}

## 你的职责

1. **需求澄清**：主动发现需求中不清晰或遗漏的部分，提出针对性问题
2. **方案建议**：基于你的经验，给出技术方案和架构建议
3. **风险提示**：识别潜在风险，给出规避建议
4. **成本解释**：解释成本构成，回答关于报价的疑问

## 对话风格

- 专业但友好，用通俗语言解释技术概念
- 主动提问，引导客户思考未考虑到的细节
- 给出建议时要有理有据
- 回答简洁，避免过长

## 需要主动询问的常见问题

如果信息不足，你可以询问：
- 用户规模和并发量要求
- 数据安全和合规要求
- 与现有系统的集成需求
- 移动端还是 Web 端优先
- 上线时间要求
- 预算范围

请开始对话，帮助客户完善需求。`
}
