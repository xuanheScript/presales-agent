'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Requirement, ParsedRequirement, RequirementType } from '@/types'

export type RequirementSource = 'manual' | 'upload'

export interface RequirementActionResult {
  error?: string
  success?: boolean
  data?: Requirement
  requirementBaselineId?: string
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
  fileUrl?: string,
  source: RequirementSource = requirementType === 'document' ? 'upload' : 'manual'
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
      source,
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
      raw_content,
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
      parsed_content: null,
    })
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) {
    console.error('更新需求失败:', error)
    return {
      error: error.code === '55000'
        ? '该需求来源已确认，不能直接覆盖。'
        : '更新需求失败，请重试',
    }
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
    return {
      error: error.code === '55000'
        ? '该需求来源已确认，不能修改分析结果。'
        : '更新需求分析结果失败，请重试',
    }
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
    return {
      error: error.code === '55000'
        ? '该需求来源已确认，不能删除。'
        : '删除需求失败，请重试',
    }
  }

  revalidatePath(`/projects/${requirement.project_id}`)
  return { success: true }
}

// 更新需求的解析结果和原始内容（用于 elicitation 完成后）
export async function updateRequirementParsedContent(
  id: string,
  parsedContent: ParsedRequirement,
  rawContent?: string
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

  const updateData: { parsed_content: ParsedRequirement; raw_content?: string } = {
    parsed_content: parsedContent,
  }

  if (rawContent) {
    updateData.raw_content = rawContent
  }

  const { data, error } = await supabase
    .from('requirements')
    .update(updateData)
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) {
    console.error('更新需求解析结果失败:', error)
    return {
      error: error.code === '55000'
        ? '该需求来源已确认，不能修改解析结果。'
        : '更新需求解析结果失败，请重试',
    }
  }

  if (!data) {
    console.error('更新需求解析结果失败: 未找到匹配的记录')
    return { error: '更新需求解析结果失败，请检查权限' }
  }

  revalidatePath(`/projects/${requirement.project_id}`)
  return { success: true, data }
}

export async function applyRequirementSource(
  projectId: string,
  requirementId: string,
  expectedBaselineId: string | null,
): Promise<RequirementActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: '请先登录' }

  const { data, error } = await supabase.rpc('apply_requirement_source', {
    p_project_id: projectId,
    p_requirement_id: requirementId,
    p_expected_baseline_id: expectedBaselineId,
  })

  if (error) {
    const message = error.code === '40001'
      ? '项目正式需求已被其他页面更新，请刷新后重新确认。'
      : error.code === '55000'
        ? error.message
        : `更新正式需求失败: ${error.message}`
    return { error: message }
  }
  if (typeof data !== 'string') {
    return { error: '数据库未返回正式需求版本 ID' }
  }

  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/analysis`)
  return { success: true, requirementBaselineId: data }
}

export async function publishInitialRequirementBaseline(
  projectId: string,
  requirementId: string
): Promise<RequirementActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: '请先登录' }

  const { data, error } = await supabase.rpc('publish_initial_requirement_baseline', {
    p_project_id: projectId,
    p_requirement_id: requirementId,
  })

  if (error) {
    const message = error.code === '55000'
      ? error.message
      : `发布需求基线失败: ${error.message}`
    return { error: message }
  }
  if (typeof data !== 'string') {
    return { error: '数据库未返回需求基线 ID' }
  }

  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/analysis`)
  return { success: true, requirementBaselineId: data }
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
