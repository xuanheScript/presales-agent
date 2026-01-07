'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { Project, ProjectStatus } from '@/types'

export interface ActionResult {
  error?: string
  success?: boolean
  data?: unknown
}

// 获取项目列表
export async function getProjects(options?: {
  status?: ProjectStatus
  industry?: string
  search?: string
  page?: number
  pageSize?: number
}): Promise<{ projects: Project[]; total: number }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { projects: [], total: 0 }
  }

  const page = options?.page || 1
  const pageSize = options?.pageSize || 10
  const offset = (page - 1) * pageSize

  let query = supabase
    .from('projects')
    .select('*', { count: 'exact' })
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })

  // 按状态筛选
  if (options?.status) {
    query = query.eq('status', options.status)
  }

  // 按行业筛选
  if (options?.industry) {
    query = query.eq('industry', options.industry)
  }

  // 搜索项目名称
  if (options?.search) {
    query = query.ilike('name', `%${options.search}%`)
  }

  // 分页
  query = query.range(offset, offset + pageSize - 1)

  const { data, count, error } = await query

  if (error) {
    console.error('获取项目列表失败:', error)
    return { projects: [], total: 0 }
  }

  return {
    projects: data || [],
    total: count || 0,
  }
}

// 获取单个项目
export async function getProject(id: string): Promise<Project | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .eq('created_by', user.id)
    .single()

  if (error) {
    console.error('获取项目详情失败:', error)
    return null
  }

  return data
}

// 创建项目
export async function createProject(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: '请先登录' }
  }

  const name = formData.get('name') as string
  const description = formData.get('description') as string
  const industry = formData.get('industry') as string

  if (!name || name.trim() === '') {
    return { error: '请填写项目名称' }
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({
      name: name.trim(),
      description: description?.trim() || null,
      industry: industry || null,
      status: 'draft',
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('创建项目失败:', error)
    return { error: '创建项目失败，请重试' }
  }

  revalidatePath('/projects')

  redirect(`/projects/${data.id}`)

}

// 更新项目
export async function updateProject(id: string, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: '请先登录' }
  }

  const name = formData.get('name') as string
  const description = formData.get('description') as string
  const industry = formData.get('industry') as string
  const status = formData.get('status') as ProjectStatus

  if (!name || name.trim() === '') {
    return { error: '请填写项目名称' }
  }

  const { error } = await supabase
    .from('projects')
    .update({
      name: name.trim(),
      description: description?.trim() || null,
      industry: industry || null,
      status: status || undefined,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('created_by', user.id)

  if (error) {
    console.error('更新项目失败:', error)
    return { error: '更新项目失败，请重试' }
  }

  revalidatePath('/projects')
  revalidatePath(`/projects/${id}`)
  return { success: true }
}

// 删除项目
export async function deleteProject(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: '请先登录' }
  }

  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', id)
    .eq('created_by', user.id)

  if (error) {
    console.error('删除项目失败:', error)
    return { error: '删除项目失败，请重试' }
  }

  revalidatePath('/projects')
  return { success: true }
}

// 归档项目
export async function archiveProject(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: '请先登录' }
  }

  const { error } = await supabase
    .from('projects')
    .update({
      status: 'archived',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('created_by', user.id)

  if (error) {
    console.error('归档项目失败:', error)
    return { error: '归档项目失败，请重试' }
  }

  revalidatePath('/projects')
  revalidatePath(`/projects/${id}`)
  return { success: true }
}
