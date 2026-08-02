import type { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  FORMAL_COST_RULE_VERSION,
  calculateFormalCostV1,
  type FormalCostCalculationResultV1,
} from '@/lib/domain/costing'
import type { DifficultyLevel, RoleEstimate } from '@/types'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export interface EditableFunctionSnapshot {
  id: string
  module_name: string
  function_name: string
  description: string | null
  difficulty_level: DifficultyLevel
  estimated_hours: number
  dependencies: string[] | null
  role_estimates: RoleEstimate[]
  is_verified: boolean
}

export interface EditableRoleSnapshot {
  id: string
  role_name: string
  responsibility: string | null
  headcount: number
  total_days: number
}

interface AdditionalWorkSnapshot {
  id: string
  work_item: string
  days: number
  assigned_roles: string[]
}

interface CostConfigSnapshot {
  id: string
  estimate_version_id?: string
  rule_version: string | null
  currency: string | null
  labor_cost_per_day: number | null
  working_hours_per_day: number | null
  buffer_coefficient: number | null
}

export interface FormalProjectAggregate {
  revision: number
  functions: EditableFunctionSnapshot[]
  roles: EditableRoleSnapshot[]
  additionalWork: AdditionalWorkSnapshot[]
  costConfig: CostConfigSnapshot
}

export class FormalCostRecalculationError extends Error {
  constructor(
    message: string,
    readonly code = 'FORMAL_COST_RECALCULATION_ERROR'
  ) {
    super(message)
    this.name = 'FormalCostRecalculationError'
  }
}

function numericValue(value: unknown, field: string): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    throw new FormalCostRecalculationError(`${field}不是有效数值`, 'INVALID_SNAPSHOT')
  }
  return numeric
}

export async function loadFormalProjectAggregate(
  supabase: SupabaseServerClient,
  projectId: string
): Promise<FormalProjectAggregate> {
  const { data, error } = await supabase.rpc('get_formal_project_cost_aggregate', {
    p_project_id: projectId,
  })

  if (error) {
    throw new FormalCostRecalculationError(`读取正式估算失败: ${error.message}`, 'DATABASE_ERROR')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new FormalCostRecalculationError('项目不存在或无权限', 'PROJECT_NOT_FOUND')
  }

  const snapshot = data as unknown as {
    revision?: unknown
    functions?: unknown
    roles?: unknown
    additionalWork?: unknown
    costConfig?: unknown
    estimateVersionId?: unknown
  }
  if (!snapshot.costConfig || typeof snapshot.costConfig !== 'object' || Array.isArray(snapshot.costConfig)) {
    throw new FormalCostRecalculationError('项目尚未生成正式成本，不能自动重算', 'COST_NOT_FOUND')
  }

  const functions = Array.isArray(snapshot.functions) ? snapshot.functions as Record<string, unknown>[] : []
  const roles = Array.isArray(snapshot.roles) ? snapshot.roles as Record<string, unknown>[] : []
  const additionalWork = Array.isArray(snapshot.additionalWork)
    ? snapshot.additionalWork as Record<string, unknown>[]
    : []
  const costConfig = snapshot.costConfig as Record<string, unknown>

  if (costConfig.rule_version !== FORMAL_COST_RULE_VERSION) {
    throw new FormalCostRecalculationError(
      '现有成本缺少可重放的正式规则快照，请先重新执行一次正式分析',
      'UNSUPPORTED_COST_VERSION'
    )
  }

  return {
    revision: numericValue(snapshot.revision, '估算版本'),
    functions: functions.map((fn) => ({
      id: String(fn.id),
      module_name: String(fn.module_name),
      function_name: String(fn.function_name),
      description: typeof fn.description === 'string' ? fn.description : null,
      difficulty_level: fn.difficulty_level as DifficultyLevel,
      estimated_hours: numericValue(fn.estimated_hours, '功能工时'),
      dependencies: Array.isArray(fn.dependencies) ? fn.dependencies as string[] : null,
      role_estimates: Array.isArray(fn.role_estimates) ? fn.role_estimates as unknown as RoleEstimate[] : [],
      is_verified: Boolean(fn.is_verified),
    })),
    roles: roles.map((role) => ({
      id: String(role.id),
      role_name: String(role.role_name),
      responsibility: typeof role.responsibility === 'string' ? role.responsibility : null,
      headcount: numericValue(role.headcount, '角色人数'),
      total_days: numericValue(role.total_days, '角色人天'),
    })),
    additionalWork: additionalWork.map((work) => ({
      id: String(work.id),
      work_item: String(work.work_item),
      days: numericValue(work.days, '额外工作人天'),
      assigned_roles: Array.isArray(work.assigned_roles) ? work.assigned_roles as string[] : [],
    })),
    costConfig: {
      id: String(costConfig.id),
      estimate_version_id: typeof snapshot.estimateVersionId === 'string'
        ? snapshot.estimateVersionId
        : undefined,
      rule_version: String(costConfig.rule_version),
      currency: typeof costConfig.currency === 'string' ? costConfig.currency : null,
      labor_cost_per_day: numericValue(costConfig.labor_cost_per_day, '人天单价'),
      working_hours_per_day: numericValue(costConfig.working_hours_per_day, '每日工作小时数'),
      buffer_coefficient: numericValue(costConfig.buffer_coefficient, '缓冲系数'),
    },
  }
}

function calculateAggregate(aggregate: FormalProjectAggregate): FormalCostCalculationResultV1 {
  return calculateFormalCostV1({
    ruleVersion: FORMAL_COST_RULE_VERSION,
    currency: aggregate.costConfig.currency || 'CNY',
    laborCostPerDay: aggregate.costConfig.labor_cost_per_day!,
    workingHoursPerDay: aggregate.costConfig.working_hours_per_day!,
    bufferCoefficient: aggregate.costConfig.buffer_coefficient!,
    roles: aggregate.roles.map((role) => ({
      role: role.role_name,
      headcount: role.headcount,
    })),
    functions: aggregate.functions.map((fn) => ({
      functionId: fn.id,
      roleEfforts: fn.role_estimates,
    })),
    additionalWork: aggregate.additionalWork.map((work) => ({
      workItemId: work.id,
      workItem: work.work_item,
      days: work.days,
      assignedRoles: work.assigned_roles,
    })),
  })
}

function buildCostSnapshot(result: FormalCostCalculationResultV1) {
  return {
    labor_cost: result.laborCost,
    service_cost: result.serviceCost,
    infrastructure_cost: result.infrastructureCost,
    buffer_percentage: (result.bufferCoefficient - 1) * 100,
    total_cost: result.totalCost,
    base_days: result.baseDays,
    buffered_days: result.bufferedDays,
    buffer_coefficient: result.bufferCoefficient,
    rule_version: result.ruleVersion,
    service_policy_version: result.servicePolicyVersion,
    currency: result.currency,
    labor_cost_per_day: result.laborCostPerDay,
    working_hours_per_day: result.workingHoursPerDay,
    breakdown: {
      roleBreakdown: result.functionalRoleBreakdown.map((line) => ({
        role: line.role,
        days: line.bufferedDays,
        baseDays: line.baseDays,
        cost: line.cost,
        headcount: line.headcount,
      })),
      additionalWorkBreakdown: result.additionalWorkBreakdown.map((line) => ({
        workItem: line.workItem,
        days: line.bufferedDays,
        baseDays: line.baseDays,
        cost: line.cost,
      })),
      thirdPartyServices: result.thirdPartyServices,
      bufferDays: result.bufferDays,
      estimatedDurationDays: result.estimatedDurationDays,
      reconciliation: result.reconciliation,
    },
  }
}

export async function mutateAndRecalculateFormalProject(
  supabase: SupabaseServerClient,
  projectId: string,
  mutate: (aggregate: FormalProjectAggregate) => void
): Promise<FormalCostCalculationResultV1> {
  const aggregate = await loadFormalProjectAggregate(supabase, projectId)
  mutate(aggregate)

  const result = calculateAggregate(aggregate)
  const totalDaysByRole = new Map(result.staffingByRole.map((role) => [role.role, role.totalDays]))
  const workingHoursPerDay = result.workingHoursPerDay

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    throw new FormalCostRecalculationError('请先登录', 'UNAUTHENTICATED')
  }

  const adminSupabase = createAdminClient()
  const { error } = await adminSupabase.rpc('commit_manual_cost_recalculation', {
    p_actor_user_id: user.id,
    p_project_id: projectId,
    p_expected_revision: aggregate.revision,
    p_functions: aggregate.functions.map((fn) => ({
      ...fn,
      estimated_hours: fn.role_estimates.reduce((sum, role) => sum + role.days, 0) * workingHoursPerDay,
    })),
    p_project_roles: aggregate.roles.map((role) => ({
      ...role,
      total_days: totalDaysByRole.get(role.role_name) || 0,
    })),
    p_cost_estimate_id: aggregate.costConfig.id,
    p_cost_estimate: buildCostSnapshot(result),
  })

  if (error) {
    const code = error.code === '40001' ? 'REVISION_CONFLICT' : 'DATABASE_ERROR'
    const message = error.code === '40001'
      ? '估算已被其他操作更新，请刷新后重试'
      : `保存成本重算结果失败: ${error.message}`
    throw new FormalCostRecalculationError(message, code)
  }

  return result
}
