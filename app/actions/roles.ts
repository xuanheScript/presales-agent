'use server'

import { createClient } from '@/lib/supabase/server'
import {
  FormalCostRecalculationError,
  mutateAndRecalculateFormalProject,
} from '@/lib/services/formal-cost-recalculation'
import { revalidatePath } from 'next/cache'

/**
 * 项目角色类型
 */
export interface ProjectRole {
  id: string
  project_id: string
  role_name: string
  responsibility: string | null
  headcount: number
  total_days: number
  created_at: string
}

/**
 * 额外工作项类型
 */
export interface AdditionalWorkItem {
  id: string
  project_id: string
  work_item: string
  days: number
  assigned_roles: string[]
  created_at: string
}

/**
 * 获取项目的角色汇总列表
 */
export async function getProjectRoles(projectId: string): Promise<ProjectRole[]> {
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
    .from('project_roles')
    .select('*')
    .eq('project_id', projectId)
    .order('total_days', { ascending: false })

  if (error) {
    console.error('获取项目角色失败:', error)
    return []
  }

  return data || []
}

/**
 * 获取项目的额外工作项列表
 */
export async function getAdditionalWorkItems(projectId: string): Promise<AdditionalWorkItem[]> {
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
    .from('additional_work_items')
    .select('*')
    .eq('project_id', projectId)
    .order('days', { ascending: false })

  if (error) {
    console.error('获取额外工作项失败:', error)
    return []
  }

  return data || []
}

/**
 * 获取角色汇总统计
 */
export async function getRolesSummary(projectId: string): Promise<{
  totalRoles: number
  totalDays: number
  totalHeadcount: number
}> {
  const roles = await getProjectRoles(projectId)

  return {
    totalRoles: roles.length,
    totalDays: roles.reduce((sum, r) => sum + Number(r.total_days), 0),
    totalHeadcount: roles.reduce((sum, r) => sum + r.headcount, 0),
  }
}

export async function updateProjectRoleHeadcount(
  roleId: string,
  headcount: number
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: '请先登录' }
  if (!Number.isInteger(headcount) || headcount <= 0) {
    return { error: '角色人数必须是正整数' }
  }

  const { data: role } = await supabase
    .from('project_roles')
    .select('project_id, projects!inner(created_by)')
    .eq('id', roleId)
    .eq('projects.created_by', user.id)
    .maybeSingle()
  if (!role) return { error: '角色不存在或无权限' }

  try {
    await mutateAndRecalculateFormalProject(supabase, role.project_id, (aggregate) => {
      const target = aggregate.roles.find((item) => item.id === roleId)
      if (!target) throw new FormalCostRecalculationError('角色不存在或已被删除')
      target.headcount = headcount
    })

    revalidatePath(`/projects/${role.project_id}`)
    revalidatePath(`/projects/${role.project_id}/functions`)
    revalidatePath(`/projects/${role.project_id}/estimation`)
    revalidatePath(`/projects/${role.project_id}/report`)
    return { success: true }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '更新人数失败，请重试',
    }
  }
}

/**
 * 获取额外工作项汇总统计
 */
export async function getAdditionalWorkSummary(projectId: string): Promise<{
  totalItems: number
  totalDays: number
}> {
  const items = await getAdditionalWorkItems(projectId)

  return {
    totalItems: items.length,
    totalDays: items.reduce((sum, i) => sum + Number(i.days), 0),
  }
}
