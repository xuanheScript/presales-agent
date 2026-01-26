'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { ChatSession, ChatMessage } from '@/types'
import type { UIMessage } from 'ai'

export interface ActionResult {
  error?: string
  success?: boolean
  data?: unknown
}

// 获取项目的会话列表
export async function getChatSessions(projectId: string): Promise<ChatSession[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return []
  }

  const { data, error } = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('获取会话列表失败:', error)
    return []
  }

  return data || []
}

// 获取单个会话详情（含消息）
export async function getChatSession(sessionId: string): Promise<{
  session: ChatSession
  messages: UIMessage[]
} | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  // 获取会话
  const { data: session, error: sessionError } = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (sessionError || !session) {
    console.error('获取会话失败:', sessionError)
    return null
  }

  // 获取消息
  const { data: messages, error: messagesError } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (messagesError) {
    console.error('获取消息失败:', messagesError)
    return null
  }

  // 转换为 UIMessage 格式
  // 使用类型断言，因为数据库中的 parts 结构与 UIMessage 兼容
  const uiMessages = (messages || []).map((msg: ChatMessage) => ({
    id: msg.id,
    role: msg.role,
    parts: msg.parts,
  })) as unknown as UIMessage[]

  return {
    session,
    messages: uiMessages,
  }
}

// 创建新会话
export async function createChatSession(projectId: string, title?: string): Promise<ChatSession | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({
      project_id: projectId,
      title: title || null,
    })
    .select()
    .single()

  if (error) {
    console.error('创建会话失败:', error)
    return null
  }

  revalidatePath(`/projects/${projectId}`)
  return data
}

// 保存会话消息（整体覆盖）
export async function saveChatMessages(
  sessionId: string,
  messages: UIMessage[]
): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: '请先登录' }
  }

  // 删除旧消息
  const { error: deleteError } = await supabase
    .from('chat_messages')
    .delete()
    .eq('session_id', sessionId)

  if (deleteError) {
    console.error('删除旧消息失败:', deleteError)
    return { error: '保存失败' }
  }

  // 如果没有消息，直接返回成功
  if (messages.length === 0) {
    return { success: true }
  }

  // 插入新消息（不使用 AI SDK 的 id，让数据库自动生成 UUID）
  const messagesToInsert = messages.map((msg) => ({
    session_id: sessionId,
    role: msg.role,
    parts: msg.parts,
    created_at: new Date().toISOString(),
  }))

  const { error: insertError } = await supabase
    .from('chat_messages')
    .insert(messagesToInsert)

  if (insertError) {
    console.error('插入消息失败:', insertError)
    return { error: '保存失败' }
  }

  // 更新会话的 updated_at 和 title
  const firstUserMessage = messages.find(m => m.role === 'user')
  let title: string | undefined
  if (firstUserMessage) {
    const textPart = firstUserMessage.parts.find(p => p.type === 'text')
    if (textPart && 'text' in textPart) {
      title = (textPart.text as string).slice(0, 50)
      if ((textPart.text as string).length > 50) {
        title += '...'
      }
    }
  }

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (title) {
    updateData.title = title
  }

  await supabase
    .from('chat_sessions')
    .update(updateData)
    .eq('id', sessionId)

  return { success: true }
}

// 删除会话
export async function deleteChatSession(sessionId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: '请先登录' }
  }

  // 先获取 project_id 用于 revalidate
  const { data: session } = await supabase
    .from('chat_sessions')
    .select('project_id')
    .eq('id', sessionId)
    .single()

  const { error } = await supabase
    .from('chat_sessions')
    .delete()
    .eq('id', sessionId)

  if (error) {
    console.error('删除会话失败:', error)
    return { error: '删除失败' }
  }

  if (session) {
    revalidatePath(`/projects/${session.project_id}`)
  }
  return { success: true }
}

// 更新会话标题
export async function updateChatSessionTitle(
  sessionId: string,
  title: string
): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: '请先登录' }
  }

  const { error } = await supabase
    .from('chat_sessions')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  if (error) {
    console.error('更新会话标题失败:', error)
    return { error: '更新失败' }
  }

  return { success: true }
}

// 获取或创建项目的默认会话
export async function getOrCreateDefaultSession(projectId: string): Promise<ChatSession | null> {
  const sessions = await getChatSessions(projectId)

  if (sessions.length > 0) {
    return sessions[0] // 返回最近更新的会话
  }

  // 如果没有会话，创建一个
  return createChatSession(projectId)
}
