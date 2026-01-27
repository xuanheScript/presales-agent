import { tool } from 'ai'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { ElicitationCollectedInfo, ElicitationQuestion } from '@/types'

/**
 * Elicitation 模式专用工具上下文
 */
interface ElicitationToolsContext {
  projectId: string
  elicitationSessionId: string
}

/**
 * 深度合并 ElicitationCollectedInfo 对象
 */
function deepMergeCollectedInfo(
  target: ElicitationCollectedInfo,
  source: Partial<ElicitationCollectedInfo>
): ElicitationCollectedInfo {
  const result: ElicitationCollectedInfo = { ...target }

  for (const key of Object.keys(source) as Array<keyof ElicitationCollectedInfo>) {
    const sourceValue = source[key]
    const targetValue = target[key]

    if (sourceValue === undefined) continue

    if (Array.isArray(sourceValue) && Array.isArray(targetValue)) {
      // 合并数组，去重
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[key] = [...new Set([...targetValue, ...sourceValue])]
    } else if (
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(sourceValue)
    ) {
      // 合并嵌套对象
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[key] = { ...targetValue, ...sourceValue }
    } else {
      // 直接覆盖
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[key] = sourceValue
    }
  }

  return result
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}

/**
 * 创建 Elicitation 模式的工具集
 */
export function createElicitationTools(context: ElicitationToolsContext) {
  const { elicitationSessionId } = context

  /**
   * 生成结构化问题
   */
  const generateQuestions = tool({
    description: `生成带选项的结构化问题，用于引导用户完善需求。

每个问题包含：
- question: 问题文本
- description: 可选的补充说明
- options: 2-4 个选项，每个选项有 label 和可选的 description
- allowMultiple: 是否允许多选（默认 false）
- allowCustom: 是否允许用户自定义输入（默认 true）
- fieldKey: 对应要更新的字段（如 projectType, businessGoals 等）

注意：
1. 问题要具体、有针对性
2. 选项要互斥（除非 allowMultiple=true）
3. 选项要覆盖常见情况，用户可以通过"其他"选项自定义输入`,
    inputSchema: z.object({
      questions: z.array(z.object({
        question: z.string().describe('问题文本'),
        description: z.string().optional().describe('问题的补充说明'),
        options: z.array(z.object({
          label: z.string().describe('选项文本'),
          description: z.string().optional().describe('选项的补充说明'),
        })).min(2).max(4).describe('2-4个选项'),
        allowMultiple: z.boolean().optional().describe('是否允许多选'),
        allowCustom: z.boolean().optional().default(true).describe('是否允许自定义输入'),
        fieldKey: z.string().optional().describe('对应的字段名'),
      })).min(1).max(3).describe('1-4个问题'),
    }),
    execute: async ({ questions }) => {
      // 为每个问题和选项生成 ID
      const questionsWithIds: ElicitationQuestion[] = questions.map(q => ({
        id: generateId(),
        question: q.question,
        description: q.description,
        options: q.options.map(o => ({
          id: generateId(),
          label: o.label,
          description: o.description,
        })),
        allowMultiple: q.allowMultiple,
        allowCustom: q.allowCustom ?? true,
        fieldKey: q.fieldKey,
      }))

      // 保存当前问题到会话
      const supabase = await createClient()
      await supabase
        .from('elicitation_sessions')
        .update({
          current_questions: questionsWithIds,
          updated_at: new Date().toISOString(),
        })
        .eq('id', elicitationSessionId)

      return {
        success: true,
        questions: questionsWithIds,
        message: `已生成 ${questionsWithIds.length} 个问题`,
      }
    },
  })

  /**
   * 更新收集的信息
   */
  const updateCollectedInfo = tool({
    description: `更新需求引导过程中收集的信息。从用户回答中提取结构化信息并保存。

可更新的字段：
- projectType: 项目类型（如：电商平台、管理系统、移动应用）
- projectSummary: 项目概述
- businessGoals: 业务目标（数组）
- keyFeatures: 核心功能（数组）
- outOfScope: 不包含的功能（数组）
- targetUsers: 目标用户（数组）
- userVolume: 用户规模
- useCases: 使用场景（数组）
- techStack: 技术栈（数组）
- platforms: 平台（数组，如Web、iOS、Android、小程序）
- integrations: 第三方集成（数组）
- nonFunctionalRequirements: 非功能需求对象
  - performance: 性能要求
  - security: 安全要求
  - scalability: 扩展性要求
  - availability: 可用性要求
- constraints: 约束条件（数组）
- risks: 潜在风险（数组）
- timeline: 时间规划对象
  - deadline: 期望上线时间
  - priority: 优先级（urgent/normal/flexible）
- budget: 预算范围

注意：只保存用户明确提到的信息，不要推测。`,
    inputSchema: z.object({
      projectType: z.string().optional().describe('项目类型'),
      projectSummary: z.string().optional().describe('项目概述'),
      businessGoals: z.array(z.string()).optional().describe('业务目标列表'),
      keyFeatures: z.array(z.string()).optional().describe('核心功能列表'),
      outOfScope: z.array(z.string()).optional().describe('不包含的功能列表'),
      targetUsers: z.array(z.string()).optional().describe('目标用户列表'),
      userVolume: z.string().optional().describe('用户规模'),
      useCases: z.array(z.string()).optional().describe('使用场景列表'),
      techStack: z.array(z.string()).optional().describe('技术栈列表'),
      platforms: z.array(z.string()).optional().describe('平台列表'),
      integrations: z.array(z.string()).optional().describe('第三方集成列表'),
      nonFunctionalRequirements: z.object({
        performance: z.string().optional().describe('性能要求'),
        security: z.string().optional().describe('安全要求'),
        scalability: z.string().optional().describe('扩展性要求'),
        availability: z.string().optional().describe('可用性要求'),
      }).optional().describe('非功能需求'),
      constraints: z.array(z.string()).optional().describe('约束条件列表'),
      risks: z.array(z.string()).optional().describe('潜在风险列表'),
      timeline: z.object({
        deadline: z.string().optional().describe('期望上线时间'),
        priority: z.enum(['urgent', 'normal', 'flexible']).optional().describe('优先级'),
      }).optional().describe('时间规划'),
      budget: z.string().optional().describe('预算范围'),
    }),
    execute: async (updates) => {
      const supabase = await createClient()

      // 获取当前会话信息
      const { data: session, error: sessionError } = await supabase
        .from('elicitation_sessions')
        .select('collected_info, current_round')
        .eq('id', elicitationSessionId)
        .single()

      if (sessionError || !session) {
        return { success: false, error: '会话不存在或已失效' }
      }

      const currentInfo = (session.collected_info || {}) as ElicitationCollectedInfo

      // 过滤掉 undefined 值
      const cleanUpdates: Partial<ElicitationCollectedInfo> = {}
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (cleanUpdates as any)[key] = value
        }
      }

      // 合并信息
      const mergedInfo = deepMergeCollectedInfo(currentInfo, cleanUpdates)

      // 更新元信息
      mergedInfo._meta = {
        lastUpdatedRound: session.current_round,
        confirmedFields: [
          ...(currentInfo._meta?.confirmedFields || []),
          ...Object.keys(cleanUpdates).filter(k => k !== '_meta'),
        ].filter((v, i, a) => a.indexOf(v) === i), // 去重
      }

      // 保存到数据库
      const { error: updateError } = await supabase
        .from('elicitation_sessions')
        .update({
          collected_info: mergedInfo,
          updated_at: new Date().toISOString(),
        })
        .eq('id', elicitationSessionId)

      if (updateError) {
        return { success: false, error: updateError.message }
      }

      const updatedFieldNames = Object.keys(cleanUpdates).filter(k => k !== '_meta')

      return {
        success: true,
        message: `已更新: ${updatedFieldNames.join('、')}`,
        updatedFields: updatedFieldNames,
      }
    },
  })

  /**
   * 完成引导会话
   */
  const completeElicitation = tool({
    description: `完成需求引导会话。当收集到足够的核心信息时调用：
- 项目类型和概述
- 业务目标
- 核心功能（至少2-3个）
- 目标用户

不需要等待所有字段都填充完毕。`,
    inputSchema: z.object({
      summary: z.string().describe('对已收集需求信息的简短总结'),
      confirmComplete: z.boolean().describe('确认完成引导'),
    }),
    execute: async ({ summary, confirmComplete }) => {
      if (!confirmComplete) {
        return { success: false, message: '未确认完成' }
      }

      const supabase = await createClient()

      // 获取当前会话
      const { data: session } = await supabase
        .from('elicitation_sessions')
        .select('collected_info, project_id')
        .eq('id', elicitationSessionId)
        .single()

      if (!session) {
        return { success: false, error: '会话不存在' }
      }

      const collectedInfo = (session.collected_info || {}) as ElicitationCollectedInfo

      // 更新会话状态为已完成
      const { error: updateError } = await supabase
        .from('elicitation_sessions')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completion_summary: summary,
        })
        .eq('id', elicitationSessionId)

      if (updateError) {
        return { success: false, error: updateError.message }
      }

      return {
        success: true,
        message: '需求引导已完成，可以进入分析阶段',
        summary,
        collectedInfo,
      }
    },
  })

  return {
    generateQuestions,
    updateCollectedInfo,
    completeElicitation,
  }
}

export type ElicitationTools = ReturnType<typeof createElicitationTools>
export type ElicitationToolName = keyof ElicitationTools
