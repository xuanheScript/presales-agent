'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type {
  ElicitationSession,
  ElicitationMessage,
  ElicitationCollectedInfo,
} from '@/types'

export interface ActionResult {
  error?: string
  success?: boolean
  data?: unknown
}

/**
 * 获取项目的活跃 elicitation 会话
 */
export async function getActiveElicitationSession(
  projectId: string
): Promise<ElicitationSession | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data, error } = await supabase
    .from('elicitation_sessions')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error && error.code !== 'PGRST116') {
    console.error('获取 elicitation 会话失败:', error)
    return null
  }

  return data
}

/**
 * 获取项目最新的 elicitation 会话（包括已完成的）
 * 用于检测会话是否已完成
 */
export async function getLatestElicitationSession(
  projectId: string
): Promise<ElicitationSession | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data, error } = await supabase
    .from('elicitation_sessions')
    .select('*')
    .eq('project_id', projectId)
    .in('status', ['active', 'completed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error && error.code !== 'PGRST116') {
    console.error('获取最新 elicitation 会话失败:', error)
    return null
  }

  return data
}

/**
 * 获取单个 elicitation 会话（不含消息）
 */
export async function getElicitationSession(
  sessionId: string
): Promise<ElicitationSession | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data, error } = await supabase
    .from('elicitation_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (error) {
    console.error('获取 elicitation 会话失败:', error)
    return null
  }

  return data
}

/**
 * 获取 elicitation 会话详情（含消息）
 */
export async function getElicitationSessionWithMessages(sessionId: string): Promise<{
  session: ElicitationSession
  messages: ElicitationMessage[]
} | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data: session, error: sessionError } = await supabase
    .from('elicitation_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (sessionError || !session) {
    console.error('获取 elicitation 会话失败:', sessionError)
    return null
  }

  const { data: messages, error: messagesError } = await supabase
    .from('elicitation_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('round', { ascending: true })
    .order('created_at', { ascending: true })

  if (messagesError) {
    console.error('获取 elicitation 消息失败:', messagesError)
    return null
  }

  return {
    session,
    messages: messages || [],
  }
}

/**
 * 获取项目的所有 elicitation 会话列表
 */
export async function getProjectElicitationSessions(
  projectId: string
): Promise<ElicitationSession[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return []
  }

  const { data, error } = await supabase
    .from('elicitation_sessions')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('获取 elicitation 会话列表失败:', error)
    return []
  }

  return data || []
}

/**
 * 创建新的 elicitation 会话
 */
export async function createElicitationSession(
  projectId: string,
  maxRounds: number = 8
): Promise<ElicitationSession | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  // 先结束现有的活跃会话
  await supabase
    .from('elicitation_sessions')
    .update({ status: 'cancelled' })
    .eq('project_id', projectId)
    .eq('status', 'active')

  const { data, error } = await supabase
    .from('elicitation_sessions')
    .insert({
      project_id: projectId,
      status: 'active',
      current_round: 0, // 从 0 开始，表示还没有进行任何轮次
      max_rounds: maxRounds,
      collected_info: {},
    })
    .select()
    .single()

  if (error) {
    console.error('创建 elicitation 会话失败:', error)
    return null
  }

  revalidatePath(`/projects/${projectId}`)
  return data
}

/**
 * 保存 elicitation 消息
 */
export async function saveElicitationMessage(
  sessionId: string,
  round: number,
  role: 'assistant' | 'user',
  content: string,
  questions?: { question: string; category: string }[]
): Promise<ElicitationMessage | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data, error } = await supabase
    .from('elicitation_messages')
    .insert({
      session_id: sessionId,
      round,
      role,
      content,
      questions: questions || null,
    })
    .select()
    .single()

  if (error) {
    console.error('保存 elicitation 消息失败:', error)
    return null
  }

  return data
}

/**
 * 更新会话的 collected_info（新版本，支持扩展后的结构）
 */
export async function updateElicitationCollectedInfo(
  sessionId: string,
  info: Partial<ElicitationCollectedInfo>
): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: '请先登录' }
  }

  // 获取现有 collected_info
  const { data: session } = await supabase
    .from('elicitation_sessions')
    .select('collected_info, current_round')
    .eq('id', sessionId)
    .single()

  const existingInfo = (session?.collected_info || {}) as ElicitationCollectedInfo

  // 深度合并（处理数组和嵌套对象）
  const mergedInfo = deepMergeCollectedInfo(existingInfo, info)

  // 更新元信息
  mergedInfo._meta = {
    lastUpdatedRound: session?.current_round || 0,
    confirmedFields: [
      ...(existingInfo._meta?.confirmedFields || []),
      ...Object.keys(info).filter(k => k !== '_meta'),
    ].filter((v, i, a) => a.indexOf(v) === i), // 去重
  }

  const { error } = await supabase
    .from('elicitation_sessions')
    .update({
      collected_info: mergedInfo,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)

  if (error) {
    console.error('更新 collected_info 失败:', error)
    return { error: '更新失败' }
  }

  return { success: true, data: mergedInfo }
}

/**
 * 深度合并 collected_info
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
      // 递归合并对象
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
 * 进入下一轮
 */
export async function advanceElicitationRound(sessionId: string): Promise<{
  session: ElicitationSession | null
  isComplete: boolean
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { session: null, isComplete: false }
  }

  // 获取当前会话
  const { data: session } = await supabase
    .from('elicitation_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (!session) {
    return { session: null, isComplete: false }
  }

  const newRound = session.current_round + 1
  const isComplete = newRound >= session.max_rounds

  if (isComplete) {
    // 达到最大轮次，标记完成
    const { data: updatedSession } = await supabase
      .from('elicitation_sessions')
      .update({
        current_round: newRound,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .select()
      .single()

    return { session: updatedSession, isComplete: true }
  }

  // 进入下一轮
  const { data: updatedSession } = await supabase
    .from('elicitation_sessions')
    .update({ current_round: newRound })
    .eq('id', sessionId)
    .select()
    .single()

  return { session: updatedSession, isComplete: false }
}

/**
 * 完成 elicitation 会话
 */
export async function completeElicitationSession(
  sessionId: string
): Promise<ElicitationSession | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data, error } = await supabase
    .from('elicitation_sessions')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .select()
    .single()

  if (error) {
    console.error('完成 elicitation 会话失败:', error)
    return null
  }

  return data
}

/**
 * 取消 elicitation 会话
 */
export async function cancelElicitationSession(
  sessionId: string
): Promise<ElicitationSession | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data, error } = await supabase
    .from('elicitation_sessions')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .select()
    .single()

  if (error) {
    console.error('取消 elicitation 会话失败:', error)
    return null
  }

  return data
}

/**
 * 获取或创建活跃的 elicitation 会话
 */
export async function getOrCreateElicitationSession(
  projectId: string,
  maxRounds: number = 8
): Promise<ElicitationSession | null> {
  const existing = await getActiveElicitationSession(projectId)
  if (existing) {
    return existing
  }
  return createElicitationSession(projectId, maxRounds)
}
