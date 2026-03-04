'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { FunctionModule, DifficultyLevel, RoleEstimate } from '@/types'

export interface FunctionActionResult {
  error?: string
  success?: boolean
  data?: FunctionModule | FunctionModule[]
}

/**
 * 获取项目的功能模块列表
 */
export async function getFunctionModules(projectId: string): Promise<FunctionModule[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return []
  }

  // 验证项目属于当前用户
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
    .from('function_modules')
    .select('*')
    .eq('project_id', projectId)
    .order('module_name', { ascending: true })
    .order('function_name', { ascending: true })

  if (error) {
    console.error('获取功能模块失败:', error)
    return []
  }

  return data || []
}

/**
 * 更新功能模块工时（同时等比缩放角色工时）
 */
export async function updateFunctionHours(
  id: string,
  estimatedHours: number
): Promise<FunctionActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: '请先登录' }
  }

  // 获取功能模块及其关联的项目（包含当前 role_estimates 和 estimated_hours）
  const { data: functionModule } = await supabase
    .from('function_modules')
    .select(`
      project_id,
      estimated_hours,
      role_estimates,
      projects!inner(created_by)
    `)
    .eq('id', id)
    .eq('projects.created_by', user.id)
    .single()

  if (!functionModule) {
    return { error: '功能模块不存在或无权限' }
  }

  // 验证工时值
  if (estimatedHours < 0) {
    return { error: '工时不能为负数' }
  }

  // 等比缩放 role_estimates
  const updatePayload: { estimated_hours: number; role_estimates?: RoleEstimate[] } = {
    estimated_hours: estimatedHours,
  }

  const roleEstimates = functionModule.role_estimates as RoleEstimate[] | null
  if (roleEstimates && roleEstimates.length > 0) {
    const oldHours = functionModule.estimated_hours as number
    if (oldHours > 0) {
      const ratio = estimatedHours / oldHours
      updatePayload.role_estimates = roleEstimates.map((re) => ({
        ...re,
        days: Math.round(re.days * ratio * 10) / 10,
      }))
    }
  }

  const { data, error } = await supabase
    .from('function_modules')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('更新功能工时失败:', error)
    return { error: '更新失败，请重试' }
  }

  revalidatePath(`/projects/${functionModule.project_id}`)
  revalidatePath(`/projects/${functionModule.project_id}/functions`)
  return { success: true, data }
}

/**
 * 更新单个角色的工时（同时重算 estimated_hours）
 */
export async function updateRoleEstimateDays(
  id: string,
  roleIndex: number,
  newDays: number
): Promise<FunctionActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: '请先登录' }
  }

  const { data: functionModule } = await supabase
    .from('function_modules')
    .select(`
      project_id,
      role_estimates,
      projects!inner(created_by)
    `)
    .eq('id', id)
    .eq('projects.created_by', user.id)
    .single()

  if (!functionModule) {
    return { error: '功能模块不存在或无权限' }
  }

  if (newDays < 0) {
    return { error: '工时不能为负数' }
  }

  const roleEstimates = functionModule.role_estimates as RoleEstimate[] | null
  if (!roleEstimates || roleIndex < 0 || roleIndex >= roleEstimates.length) {
    return { error: '角色工时数据不存在' }
  }

  // 更新指定角色的 days
  const updatedEstimates = roleEstimates.map((re, idx) =>
    idx === roleIndex ? { ...re, days: newDays } : re
  )

  // 重算 estimated_hours
  const totalDays = updatedEstimates.reduce((sum, re) => sum + re.days, 0)
  const estimatedHours = totalDays * 8

  const { data, error } = await supabase
    .from('function_modules')
    .update({
      role_estimates: updatedEstimates,
      estimated_hours: estimatedHours,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('更新角色工时失败:', error)
    return { error: '更新失败，请重试' }
  }

  revalidatePath(`/projects/${functionModule.project_id}`)
  revalidatePath(`/projects/${functionModule.project_id}/functions`)
  return { success: true, data }
}

/**
 * 更新功能模块难度
 */
export async function updateFunctionDifficulty(
  id: string,
  difficultyLevel: DifficultyLevel
): Promise<FunctionActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: '请先登录' }
  }

  const { data: functionModule } = await supabase
    .from('function_modules')
    .select(`
      project_id,
      projects!inner(created_by)
    `)
    .eq('id', id)
    .eq('projects.created_by', user.id)
    .single()

  if (!functionModule) {
    return { error: '功能模块不存在或无权限' }
  }

  const { data, error } = await supabase
    .from('function_modules')
    .update({ difficulty_level: difficultyLevel })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('更新功能难度失败:', error)
    return { error: '更新失败，请重试' }
  }

  revalidatePath(`/projects/${functionModule.project_id}`)
  revalidatePath(`/projects/${functionModule.project_id}/functions`)
  return { success: true, data }
}

/**
 * 删除功能模块
 */
export async function deleteFunctionModule(id: string): Promise<FunctionActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: '请先登录' }
  }

  const { data: functionModule } = await supabase
    .from('function_modules')
    .select(`
      project_id,
      projects!inner(created_by)
    `)
    .eq('id', id)
    .eq('projects.created_by', user.id)
    .single()

  if (!functionModule) {
    return { error: '功能模块不存在或无权限' }
  }

  const { error } = await supabase
    .from('function_modules')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('删除功能模块失败:', error)
    return { error: '删除失败，请重试' }
  }

  revalidatePath(`/projects/${functionModule.project_id}`)
  revalidatePath(`/projects/${functionModule.project_id}/functions`)
  return { success: true }
}

/**
 * 添加功能模块
 */
export async function addFunctionModule(
  projectId: string,
  data: {
    moduleName: string
    functionName: string
    description?: string
    difficultyLevel: DifficultyLevel
    estimatedHours: number
  }
): Promise<FunctionActionResult> {
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

  // 验证数据
  if (!data.moduleName?.trim() || !data.functionName?.trim()) {
    return { error: '模块名称和功能名称为必填项' }
  }

  const { data: newModule, error } = await supabase
    .from('function_modules')
    .insert({
      project_id: projectId,
      module_name: data.moduleName.trim(),
      function_name: data.functionName.trim(),
      description: data.description?.trim() || null,
      difficulty_level: data.difficultyLevel,
      estimated_hours: data.estimatedHours,
    })
    .select()
    .single()

  if (error) {
    console.error('添加功能模块失败:', error)
    return { error: '添加失败，请重试' }
  }

  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/functions`)
  return { success: true, data: newModule }
}

/**
 * 切换功能模块的验证状态
 */
export async function toggleFunctionVerified(
  id: string
): Promise<FunctionActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: '请先登录' }
  }

  // 获取当前状态
  const { data: functionModule } = await supabase
    .from('function_modules')
    .select(`
      is_verified,
      project_id,
      projects!inner(created_by)
    `)
    .eq('id', id)
    .eq('projects.created_by', user.id)
    .single()

  if (!functionModule) {
    return { error: '功能模块不存在或无权限' }
  }

  const { data, error } = await supabase
    .from('function_modules')
    .update({ is_verified: !functionModule.is_verified })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('更新验证状态失败:', error)
    return { error: '更新失败，请重试' }
  }

  revalidatePath(`/projects/${functionModule.project_id}/functions`)
  return { success: true, data }
}

/**
 * 计算功能模块汇总
 */
export async function getFunctionSummary(projectId: string): Promise<{
  totalModules: number
  totalHours: number
  byDifficulty: Record<DifficultyLevel, number>
}> {
  const modules = await getFunctionModules(projectId)

  const byDifficulty: Record<DifficultyLevel, number> = {
    simple: 0,
    medium: 0,
    complex: 0,
    very_complex: 0,
  }

  let totalHours = 0

  for (const module of modules) {
    totalHours += module.estimated_hours
    byDifficulty[module.difficulty_level]++
  }

  return {
    totalModules: modules.length,
    totalHours,
    byDifficulty,
  }
}
