'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Requirement, ParsedRequirement, RequirementType } from '@/types'

export interface RequirementActionResult {
  error?: string
  success?: boolean
  data?: Requirement
}

// 获取项目的需求列表
export async function getRequirements(projectId: string): Promise<Requirement[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return []
  }

  // 先验证项目属于当前用户
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('created_by', user.id)
    .single()

  if (!project) {
    return []
  }

  const { data, error } = await supabase
    .from('requirements')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('获取需求列表失败:', error)
    return []
  }

  return data || []
}

// 获取单个需求
export async function getRequirement(id: string): Promise<Requirement | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data, error } = await supabase
    .from('requirements')
    .select(`
      *,
      projects!inner(created_by)
    `)
    .eq('id', id)
    .eq('projects.created_by', user.id)
    .single()

  if (error) {
    console.error('获取需求详情失败:', error)
    return null
  }

  return data
}

// 创建需求
export async function createRequirement(
  projectId: string,
  rawContent: string,
  requirementType: RequirementType = 'text',
  fileUrl?: string
): Promise<RequirementActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: '请先登录' }
  }

  // 验证项目属于当前用户
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('created_by', user.id)
    .single()

  if (!project) {
    return { error: '项目不存在或无权限' }
  }

  if (!rawContent || rawContent.trim() === '') {
    return { error: '请输入需求内容' }
  }

  const { data, error } = await supabase
    .from('requirements')
    .insert({
      project_id: projectId,
      raw_content: rawContent.trim(),
      requirement_type: requirementType,
      file_url: fileUrl || null,
    })
    .select()
    .single()

  if (error) {
    console.error('创建需求失败:', error)
    return { error: '创建需求失败，请重试' }
  }

  revalidatePath(`/projects/${projectId}`)
  return { success: true, data }
}

// 更新需求
export async function updateRequirement(
  id: string,
  rawContent: string
): Promise<RequirementActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: '请先登录' }
  }

  // 获取需求及其关联的项目
  const { data: requirement, error: fetchError } = await supabase
    .from('requirements')
    .select(`
      project_id,
      projects!inner(created_by)
    `)
    .eq('id', id)
    .eq('projects.created_by', user.id)
    .maybeSingle()

  if (fetchError) {
    console.error('查询需求失败:', fetchError)
    return { error: '查询需求失败，请重试' }
  }

  if (!requirement) {
    return { error: '需求不存在或无权限' }
  }

  const { data, error } = await supabase
    .from('requirements')
    .update({
      raw_content: rawContent.trim(),
    })
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) {
    console.error('更新需求失败:', error)
    return { error: '更新需求失败，请重试' }
  }

  if (!data) {
    console.error('更新需求失败: 未找到匹配的记录，可能是 RLS 策略阻止了更新')
    return { error: '更新需求失败，请检查权限' }
  }

  revalidatePath(`/projects/${requirement.project_id}`)
  return { success: true, data }
}

// 更新需求的解析结果
export async function updateRequirementAnalysis(
  id: string,
  parsedContent: ParsedRequirement
): Promise<RequirementActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: '请先登录' }
  }

  const { data: requirement, error: fetchError } = await supabase
    .from('requirements')
    .select(`
      project_id,
      projects!inner(created_by)
    `)
    .eq('id', id)
    .eq('projects.created_by', user.id)
    .maybeSingle()

  if (fetchError) {
    console.error('查询需求失败:', fetchError)
    return { error: '查询需求失败，请重试' }
  }

  if (!requirement) {
    return { error: '需求不存在或无权限' }
  }

  const { data, error } = await supabase
    .from('requirements')
    .update({
      parsed_content: parsedContent,
    })
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) {
    console.error('更新需求分析结果失败:', error)
    return { error: '更新需求分析结果失败，请重试' }
  }

  if (!data) {
    console.error('更新需求分析结果失败: 未找到匹配的记录，可能是 RLS 策略阻止了更新')
    return { error: '更新需求分析结果失败，请检查权限' }
  }

  revalidatePath(`/projects/${requirement.project_id}`)
  return { success: true, data }
}

// 删除需求
export async function deleteRequirement(id: string): Promise<RequirementActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: '请先登录' }
  }

  const { data: requirement, error: fetchError } = await supabase
    .from('requirements')
    .select(`
      project_id,
      projects!inner(created_by)
    `)
    .eq('id', id)
    .eq('projects.created_by', user.id)
    .maybeSingle()

  if (fetchError) {
    console.error('查询需求失败:', fetchError)
    return { error: '查询需求失败，请重试' }
  }

  if (!requirement) {
    return { error: '需求不存在或无权限' }
  }

  const { error } = await supabase
    .from('requirements')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('删除需求失败:', error)
    return { error: '删除需求失败，请重试' }
  }

  revalidatePath(`/projects/${requirement.project_id}`)
  return { success: true }
}

// 获取项目的最新需求
export async function getLatestRequirement(projectId: string): Promise<Requirement | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  // 验证项目属于当前用户
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('created_by', user.id)
    .single()

  if (!project) {
    return null
  }

  const { data, error } = await supabase
    .from('requirements')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error) {
    // 可能是没有需求，不是真正的错误
    return null
  }

  return data
}
