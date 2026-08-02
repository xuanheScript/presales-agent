import { after } from 'next/server'
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai'
import { defaultModel } from '@/lib/ai/config'
import { createChatTools } from '@/lib/ai/chat-tools'
import {
  createElicitationTools,
  buildElicitationSystemPrompt,
} from '@/lib/ai/elicitation'
import { createTelemetryConfig, flushLangfuse } from '@/lib/observability/langfuse'
import { createManagedAbortSignal, EXECUTION_POLICY } from '@/lib/agents/execution-policy'
import { getProject } from '@/app/actions/projects'
import { getLatestRequirement } from '@/app/actions/requirements'
import { getFunctionModules } from '@/app/actions/functions'
import { getCostEstimate } from '@/app/actions/costs'
import { saveChatMessages } from '@/app/actions/chat-sessions'
import {
  getOrCreateElicitationSession,
  getElicitationSession,
  saveElicitationMessage,
  advanceElicitationRound,
  finalizeElicitationSession,
} from '@/app/actions/elicitation-sessions'
import type { ChatMode, ElicitationCollectedInfo } from '@/types'

export const maxDuration = 120 // 增加超时时间以支持工具调用

interface ChatRequest {
  messages: UIMessage[]
  projectId: string
  sessionId?: string // 会话 ID，用于消息持久化（internal 模式）
  mode?: ChatMode // 对话模式，默认 internal
  elicitationSessionId?: string // elicitation 会话 ID
  userWantsToComplete?: boolean // 用户主动结束引导
}

interface ElicitationResponseMeta {
  sessionId: string
  currentRound: number
  maxRounds: number
  collectedInfo: ElicitationCollectedInfo
  isComplete: boolean
}

/**
 * POST /api/chat
 *
 * 对话式需求引导 API
 * 支持两种模式：
 * - internal: 传统模式，AI 辅助完善已有需求
 * - elicitation: 苏格拉底式多轮提问，主动收集需求
 */
export async function POST(req: Request) {
  try {
    const {
      messages,
      projectId,
      sessionId,
      mode = 'internal',
      elicitationSessionId,
      userWantsToComplete,
    }: ChatRequest = await req.json()

    if (!projectId) {
      return new Response(
        JSON.stringify({ error: '缺少项目 ID' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 根据模式选择不同的处理逻辑
    if (mode === 'elicitation') {
      return handleElicitationMode({
        messages,
        projectId,
        elicitationSessionId,
        userWantsToComplete,
        signal: req.signal,
      })
    }

    // 默认使用 internal 模式
    return handleInternalMode({
      messages,
      projectId,
      sessionId,
      signal: req.signal,
    })
  } catch (error) {
    console.error('[Chat API] 对话失败:', error)

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : '对话失败' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

/**
 * 处理 Internal 模式（传统需求对话）
 */
async function handleInternalMode({
  messages,
  projectId,
  sessionId,
  signal,
}: {
  messages: UIMessage[]
  projectId: string
  sessionId?: string
  signal: AbortSignal
}) {
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

  // 需要 requirementId 来支持工具调用
  const requirementId = requirement?.id || ''

  // 创建带有上下文的工具集
  const tools = createChatTools({
    projectId,
    requirementId,
  })

  // 构建系统提示词，包含项目上下文
  const systemPrompt = buildInternalSystemPrompt(project, requirement, functions, costEstimate)

  // 将 UI 消息转换为模型消息格式
  const modelMessages = await convertToModelMessages(messages)
  const managed = createManagedAbortSignal([signal], EXECUTION_POLICY.chatTimeoutMs)

  // 使用 AI SDK 进行流式对话，包含工具支持
  const result = streamText({
    model: defaultModel,
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(5), // 允许最多 5 步工具调用
    abortSignal: managed.signal,
    maxRetries: EXECUTION_POLICY.aiMaxRetries,
    experimental_telemetry: createTelemetryConfig('chat-internal', {
      projectId,
      sessionId: sessionId || 'none',
    }),
  })

  const consumption = result.consumeStream()

  after(async () => {
    try {
      await consumption
    } finally {
      managed.dispose()
      await flushLangfuse()
    }
  })

  // AI SDK v6 使用 toUIMessageStreamResponse() 与 useChat 配合
  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: async ({ messages: finalMessages }) => {
      // 如果有 sessionId，保存消息到数据库
      if (sessionId) {
        await saveChatMessages(sessionId, finalMessages)
      }
    },
  })
}

/**
 * 处理 Elicitation 模式（苏格拉底式需求引导）
 */
async function handleElicitationMode({
  messages,
  projectId,
  elicitationSessionId,
  userWantsToComplete,
  signal,
}: {
  messages: UIMessage[]
  projectId: string
  elicitationSessionId?: string
  userWantsToComplete?: boolean
  signal: AbortSignal
}) {
  const project = await getProject(projectId)

  if (!project) {
    return new Response(
      JSON.stringify({ error: '项目不存在' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // 获取或创建 elicitation 会话
  const session = elicitationSessionId
    ? await getElicitationSession(elicitationSessionId)
    : await getOrCreateElicitationSession(projectId)

  if (!session) {
    return new Response(
      JSON.stringify({ error: '无法创建或获取引导会话' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (session.project_id !== projectId) {
    return new Response(
      JSON.stringify({ error: '引导会话与项目不匹配' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (session.status !== 'active') {
    return new Response(
      JSON.stringify({ error: session.status === 'completed' ? '该引导会话已完成' : '该引导会话已取消' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (session.current_round >= session.max_rounds) {
    const finalized = await finalizeElicitationSession({ sessionId: session.id })
    if (finalized.error || !finalized.session) {
      return new Response(
        JSON.stringify({ error: finalized.error || '完成引导失败' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        error: '已达到最大轮次，会话已自动完成',
        elicitation: buildElicitationMeta(finalized.session),
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const collectedInfo = (session.collected_info || {}) as ElicitationCollectedInfo

  if (userWantsToComplete) {
    const finalized = await finalizeElicitationSession({ sessionId: session.id })
    if (finalized.error || !finalized.session) {
      return new Response(
        JSON.stringify({ error: finalized.error || '完成引导失败' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        message: '需求引导已完成',
        elicitation: buildElicitationMeta(finalized.session),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // 获取原始需求文本
  const requirement = await getLatestRequirement(projectId)
  const rawRequirement = requirement?.raw_content || undefined

  let completionIntent: { summary: string } | null = null

  // 创建 Elicitation 工具集
  const tools = createElicitationTools({
    projectId,
    elicitationSessionId: session.id,
    requestCompletion: (intent) => {
      completionIntent = intent
    },
  })

  // 提取用户初始输入（第一条用户消息）
  const firstUserMessage = messages.find(m => m.role === 'user')
  const userInitialInput = firstUserMessage?.parts
    ?.filter(p => p.type === 'text')
    .map(p => (p as { text: string }).text)
    .join('') || undefined

  // 构建 Elicitation 系统提示词
  const systemPrompt = buildElicitationSystemPrompt({
    collectedInfo,
    currentRound: session.current_round + 1, // 显示给用户的轮次从1开始
    maxRounds: session.max_rounds,
    userInitialInput: typeof userInitialInput === 'string' ? userInitialInput : undefined,
    rawRequirement: typeof rawRequirement === 'string' ? rawRequirement : undefined,
  })

  // 将 UI 消息转换为模型消息格式
  const modelMessages = await convertToModelMessages(messages)
  const managed = createManagedAbortSignal([signal], EXECUTION_POLICY.chatTimeoutMs)

  // 使用 AI SDK 进行流式对话
  const result = streamText({
    model: defaultModel,
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(5),
    abortSignal: managed.signal,
    maxRetries: EXECUTION_POLICY.aiMaxRetries,
    experimental_telemetry: createTelemetryConfig('chat-elicitation', {
      projectId,
      sessionId: session.id,
      round: session.current_round + 1,
    }),
  })

  const consumption = result.consumeStream()

  after(async () => {
    try {
      await consumption
    } finally {
      managed.dispose()
      await flushLangfuse()
    }
  })

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: async ({ messages: finalMessages, isAborted, finishReason }) => {
      if (isAborted || finishReason === 'error') {
        return
      }

      // 保存消息到 elicitation_messages
      const lastUserMessage = messages[messages.length - 1]
      const lastAssistantMessage = finalMessages[finalMessages.length - 1]

      let savedUserMessage = true
      let savedAssistantMessage = true

      if (lastUserMessage?.role === 'user') {
        const userContent = lastUserMessage.parts
          ?.filter(p => p.type === 'text')
          .map(p => (p as { text: string }).text)
          .join('') || ''

        savedUserMessage = Boolean(await saveElicitationMessage(
          session!.id,
          session!.current_round + 1,
          'user',
          userContent
        ))
      }

      if (lastAssistantMessage?.role === 'assistant') {
        const content = lastAssistantMessage.parts
          ?.filter(p => p.type === 'text')
          .map(p => (p as { text: string }).text)
          .join('') || ''

        savedAssistantMessage = Boolean(await saveElicitationMessage(
          session!.id,
          session!.current_round + 1,
          'assistant',
          content
        ))
      }

      if (!savedUserMessage || !savedAssistantMessage) {
        console.error('[Elicitation] 消息保存失败，跳过轮次推进')
        return
      }

      const intent = completionIntent as { summary: string } | null
      if (intent) {
        const finalized = await finalizeElicitationSession({
          sessionId: session!.id,
          summary: intent.summary,
        })
        if (finalized.error) {
          console.error('[Elicitation] AI 完成引导失败:', finalized.error)
        }
        return
      }

      const advanced = await advanceElicitationRound(session!.id)
      if (advanced.error) {
        console.error('[Elicitation] 推进轮次失败:', advanced.error)
        return
      }

      if (advanced.reachedMaxRounds) {
        const finalized = await finalizeElicitationSession({ sessionId: session!.id })
        if (finalized.error) {
          console.error('[Elicitation] 最大轮次完成失败:', finalized.error)
        }
      }
    },
    // 添加 elicitation 元数据到响应头
    headers: {
      'X-Elicitation-Session-Id': session.id,
      'X-Elicitation-Round': String(session.current_round + 1),
    },
  })
}

/**
 * 构建 Elicitation 响应元数据
 */
function buildElicitationMeta(session: NonNullable<Awaited<ReturnType<typeof getElicitationSession>>>): ElicitationResponseMeta {
  const collectedInfo = (session.collected_info || {}) as ElicitationCollectedInfo

  return {
    sessionId: session.id,
    currentRound: session.current_round,
    maxRounds: session.max_rounds,
    collectedInfo,
    isComplete: session.status === 'completed',
  }
}

/**
 * 构建 Internal 模式系统提示词
 */
function buildInternalSystemPrompt(
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
${functions.slice(0, 10).map(f => `- [ID:${f.id}] ${f.module_name} / ${f.function_name}：${f.estimated_hours}小时（${f.difficulty_level}）`).join('\n')}
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

  return `你是一位资深的售前顾问和项目经理。你正在与客户进行需求沟通对话，帮助他们完善项目需求。

${contextInfo}

## 你的职责

1. **需求完善**：主动发现需求中不清晰或遗漏的部分，提出针对性问题
2. **方案建议**：基于你的经验，给出技术方案和架构建议
3. **风险提示**：识别潜在风险，给出规避建议
4. **成本解释**：解释成本构成，回答关于报价的疑问
5. **信息保存**：当用户确认了新的需求细节、功能点或修改时，使用工具将信息保存到数据库

## 可用工具

你有以下工具可以使用来保存和查询数据：

### 需求管理
- updateRequirement: 更新需求内容
- appendRequirement: 追加需求内容（不覆盖原有）
- updateParsedRequirement: 更新需求分析结果（项目类型、业务目标、技术栈等）

### 功能模块
- addFunctionModule: 添加单个功能模块
- addFunctionModulesBatch: 批量添加功能模块
- updateFunctionHours: 更新功能工时
- updateFunctionDifficulty: 更新功能难度
- deleteFunctionModule: 删除功能模块
- addFromLibrary: 从功能库添加标准功能

### 成本估算
- updateCostParameters: 更新成本参数（风险缓冲、服务成本等）
- recalculateCost: 重新计算总成本

### 项目信息
- updateProjectDescription: 更新项目描述
- updateProjectIndustry: 更新项目行业

### 查询工具
- getFunctionModules: 获取功能模块列表
- getCostSummary: 获取成本汇总
- searchFunctionLibrary: 搜索功能库
- getProjectSummary: 获取项目汇总
- getSystemConfig: 获取系统成本配置（人天成本、风险缓冲比例等），这是成本估算的核心数据源

## 工具使用原则

1. **获得确认后再保存**：在保存信息前，确保用户已明确确认
2. **成本计算前获取配置**：在进行成本估算或向用户解释成本时，先调用 getSystemConfig 获取最新的人天成本和风险缓冲比例配置
3. **及时更新成本**：添加或修改功能后，调用 recalculateCost 更新成本
4. **主动查询**：需要了解当前状态时，使用查询工具获取最新数据
5. **批量操作**：多个功能一起添加时，使用 addFunctionModulesBatch

## 对话风格

- 专业但友好，用通俗语言解释技术概念
- 主动提问，引导客户思考未考虑到的细节
- 给出建议时要有理有据
- 回答简洁，避免过长
- 保存信息后，简要告知用户已保存的内容

## 需要主动询问的常见问题

如果信息不足，你可以询问：
- 用户规模和并发量要求
- 数据安全和合规要求
- 与现有系统的集成需求
- 移动端还是 Web 端优先
- 上线时间要求
- 预算范围

请开始对话，帮助客户完善需求。当客户确认了新的信息时，记得使用工具保存。`
}
