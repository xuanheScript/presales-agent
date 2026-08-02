'use server'

import { createClient } from '@/lib/supabase/server'
import {
  FormalCostRecalculationError,
  mutateAndRecalculateFormalProject,
  type EditableFunctionSnapshot,
  type FormalProjectAggregate,
} from '@/lib/services/formal-cost-recalculation'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { FunctionModule, DifficultyLevel, RoleEstimate } from '@/types'

export interface FunctionActionResult {
  error?: string
  success?: boolean
  data?: FunctionModule | FunctionModule[]
}

const idSchema = z.string().uuid()
const nonNegativeDaysSchema = z.number().finite().min(0)
const addFunctionSchema = z.object({
  moduleName: z.string().trim().min(1),
  functionName: z.string().trim().min(1),
  description: z.string().optional(),
  difficultyLevel: z.enum(['simple', 'medium', 'complex', 'very_complex']),
  roleEstimates: z.array(z.object({
    role: z.string().min(1).refine((role) => role === role.trim()),
    days: nonNegativeDaysSchema,
    reason: z.string().optional(),
  })).min(1),
})

function errorMessage(error: unknown): string {
  if (error instanceof FormalCostRecalculationError) return error.message
  return error instanceof Error ? error.message : '操作失败，请重试'
}

function revalidateFormalEstimate(projectId: string): void {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/functions`)
  revalidatePath(`/projects/${projectId}/estimation`)
  revalidatePath(`/projects/${projectId}/report`)
}

async function getOwnedProjectIdForFunction(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('function_modules')
    .select('project_id, projects!inner(created_by)')
    .eq('id', id)
    .eq('projects.created_by', userId)
    .maybeSingle()

  return data?.project_id || null
}

function findFunction(
  aggregate: FormalProjectAggregate,
  id: string
): EditableFunctionSnapshot {
  const fn = aggregate.functions.find((item) => item.id === id)
  if (!fn) throw new FormalCostRecalculationError('功能模块不存在或已被删除', 'FUNCTION_NOT_FOUND')
  return fn
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
  estimatedDays: number
): Promise<FunctionActionResult> {
  const input = z.object({
    id: idSchema,
    estimatedDays: nonNegativeDaysSchema,
  }).safeParse({ id, estimatedDays })
  if (!input.success) return { error: '功能 ID 或人天格式无效' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '请先登录' }

  const projectId = await getOwnedProjectIdForFunction(supabase, id, user.id)
  if (!projectId) return { error: '功能模块不存在或无权限' }

  try {
    await mutateAndRecalculateFormalProject(supabase, projectId, (aggregate) => {
      const fn = findFunction(aggregate, id)
      if (fn.role_estimates.length === 0) {
        throw new FormalCostRecalculationError('该功能尚未分配角色，不能调整总工时')
      }

      const targetDays = estimatedDays
      const currentDays = fn.role_estimates.reduce((sum, role) => sum + role.days, 0)
      if (currentDays <= 0) {
        throw new FormalCostRecalculationError('当前角色工时为 0，请直接编辑各角色人天')
      }

      const targetTenths = Math.round(targetDays * 10)
      const exactTenths = fn.role_estimates.map((role, index) => ({
        index,
        exact: (role.days / currentDays) * targetTenths,
      }))
      const allocatedTenths = exactTenths.map((item) => Math.floor(item.exact))
      let remainingTenths = targetTenths - allocatedTenths.reduce((sum, value) => sum + value, 0)
      const order = [...exactTenths].sort((a, b) => {
        const remainderDifference = (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact))
        return remainderDifference || a.index - b.index
      })
      for (let index = 0; remainingTenths > 0; index++, remainingTenths--) {
        allocatedTenths[order[index % order.length].index] += 1
      }

      fn.role_estimates = fn.role_estimates.map((role, index) => ({
        ...role,
        days: allocatedTenths[index] / 10,
      }))
    })

    revalidateFormalEstimate(projectId)
    return { success: true }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

/**
 * 更新单个角色的工时（同时重算 estimated_hours）
 */
export async function updateRoleEstimateDays(
  id: string,
  roleName: string,
  newDays: number
): Promise<FunctionActionResult> {
  const input = z.object({
    id: idSchema,
    roleName: z.string().min(1).refine((role) => role === role.trim()),
    newDays: nonNegativeDaysSchema,
  }).safeParse({ id, roleName, newDays })
  if (!input.success) return { error: '功能 ID、角色名称或工时格式无效' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: '请先登录' }

  const projectId = await getOwnedProjectIdForFunction(supabase, id, user.id)
  if (!projectId) return { error: '功能模块不存在或无权限' }

  try {
    await mutateAndRecalculateFormalProject(supabase, projectId, (aggregate) => {
      const fn = findFunction(aggregate, id)
      const role = fn.role_estimates.find((item) => item.role === roleName)
      if (!role) {
        throw new FormalCostRecalculationError('角色工时数据不存在')
      }
      role.days = newDays
    })

    revalidateFormalEstimate(projectId)
    return { success: true }
  } catch (error) {
    return { error: errorMessage(error) }
  }
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
  const input = z.object({ id: idSchema }).safeParse({ id })
  if (!input.success) return { error: '功能 ID 格式无效' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: '请先登录' }
  const projectId = await getOwnedProjectIdForFunction(supabase, id, user.id)
  if (!projectId) return { error: '功能模块不存在或无权限' }

  try {
    await mutateAndRecalculateFormalProject(supabase, projectId, (aggregate) => {
      const index = aggregate.functions.findIndex((fn) => fn.id === id)
      if (index < 0) throw new FormalCostRecalculationError('功能模块不存在或已被删除')
      aggregate.functions.splice(index, 1)
    })

    revalidateFormalEstimate(projectId)
    return { success: true }
  } catch (error) {
    return { error: errorMessage(error) }
  }
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
    roleEstimates: RoleEstimate[]
  }
): Promise<FunctionActionResult> {
  const input = z.object({
    projectId: idSchema,
    data: addFunctionSchema,
  }).safeParse({ projectId, data })
  if (!input.success) return { error: '新增功能数据格式无效' }
  const validatedData = input.data.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: '请先登录' }

  const roleEstimates = validatedData.roleEstimates.filter((role) => role.days > 0)
  if (roleEstimates.length === 0) {
    return { error: '请至少为一个项目角色分配人天' }
  }
  if (roleEstimates.some((role) => !role.role.trim() || !Number.isFinite(role.days) || role.days < 0)) {
    return { error: '角色人天数据无效' }
  }

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('created_by', user.id)
    .maybeSingle()
  if (!project) return { error: '项目不存在或无权限' }

  try {
    const newId = crypto.randomUUID()
    await mutateAndRecalculateFormalProject(supabase, projectId, (aggregate) => {
      const projectRoles = new Set(aggregate.roles.map((role) => role.role_name))
      for (const role of roleEstimates) {
        if (!projectRoles.has(role.role)) {
          throw new FormalCostRecalculationError(`项目角色不存在: ${role.role}`)
        }
      }

      aggregate.functions.push({
        id: newId,
        module_name: validatedData.moduleName,
        function_name: validatedData.functionName,
        description: validatedData.description?.trim() || null,
        difficulty_level: validatedData.difficultyLevel,
        estimated_hours: 0,
        dependencies: null,
        role_estimates: roleEstimates,
        is_verified: false,
      })
    })

    revalidateFormalEstimate(projectId)
    return { success: true }
  } catch (error) {
    return { error: errorMessage(error) }
  }
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

  for (const functionModule of modules) {
    totalHours += functionModule.estimated_hours
    byDifficulty[functionModule.difficulty_level]++
  }

  return {
    totalModules: modules.length,
    totalHours,
    byDifficulty,
  }
}
