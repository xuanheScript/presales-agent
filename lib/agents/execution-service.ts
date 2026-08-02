import { DEFAULT_CONFIG } from '@/constants'
import { createClient } from '@/lib/supabase/server'
import { withLangfuseTrace } from '@/lib/observability/langfuse'
import {
  EXECUTION_POLICY,
  getErrorMessage,
  isAbortError,
  isTimeoutError,
  type WorkflowRunOptions,
} from './execution-policy'
import { runPresalesWorkflow, streamPresalesWorkflow } from './graph'
import type {
  WorkflowResult,
  WorkflowSystemConfig,
  PresalesState,
} from './state'
import type { ProjectStatus } from '@/types'

export type PresalesTransport = 'run' | 'stream'
export type PresalesExecutionTerminalStatus = 'failed' | 'cancelled' | 'timed_out'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export class PresalesExecutionError extends Error {
  constructor(
    message: string,
    readonly status: number = 500,
    readonly code = 'PRESALES_EXECUTION_ERROR'
  ) {
    super(message)
    this.name = 'PresalesExecutionError'
  }
}

export interface PreparedPresalesExecution {
  supabase: SupabaseServerClient
  userId: string
  projectId: string
  requirementId: string
  rawRequirement: string
  projectDescription: string
  previousProjectStatus: ProjectStatus
  systemConfig: WorkflowSystemConfig
}

export interface PresalesPersistenceSnapshot {
  parsedRequirement: NonNullable<WorkflowResult['analysis']>
  functionModules: Array<{
    module_name: string
    function_name: string
    description: string
    difficulty_level: string
    estimated_hours: number
    dependencies: string[] | null
    role_estimates: Array<{ role: string; days: number; reason?: string }>
  }>
  projectRoles: Array<{
    role_name: string
    responsibility: string
    headcount: number
    total_days: number
  }>
  additionalWorkItems: Array<{
    work_item: string
    days: number
    assigned_roles: string[]
  }>
  costEstimate: {
    labor_cost: number
    service_cost: number
    infrastructure_cost: number
    buffer_percentage: number
    total_cost: number
    base_days: number
    buffered_days: number
    buffer_coefficient: number
    rule_version: string
    service_policy_version: string
    currency: string
    labor_cost_per_day: number
    working_hours_per_day: number
    breakdown: {
      roleBreakdown: NonNullable<WorkflowResult['cost']>['roleBreakdown']
      additionalWorkBreakdown: NonNullable<WorkflowResult['cost']>['additionalWorkBreakdown']
      thirdPartyServices: NonNullable<WorkflowResult['cost']>['thirdPartyServices']
      ruleVersion: string
      servicePolicyVersion: string
      currency: string
      laborCostPerDay: number
      workingHoursPerDay: number
      bufferDays: number
      estimatedDurationDays: number
      reconciliation: NonNullable<WorkflowResult['cost']>['reconciliation']
    }
  }
  outputData: WorkflowResult
}

export interface PresalesExecutionHandle {
  executionId: string
  prepared: PreparedPresalesExecution
  startedAt: number
  transport: PresalesTransport
}

function assertUuidLike(value: string, field: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new PresalesExecutionError(`${field} 格式无效`, 400, 'INVALID_ID')
  }
}

function throwRpcError(error: { message: string; code?: string } | null, fallback: string): never | void {
  if (!error) return

  const status = error.code === '23505' || error.code === '40001'
    ? 409
    : error.code === 'P0002'
      ? 404
      : error.code === '23503' || error.code === 'P0001'
        ? 400
        : 500

  throw new PresalesExecutionError(error.message || fallback, status, error.code || 'DATABASE_ERROR')
}

function numericConfigValue(value: unknown, fallback: number): number {
  const numericValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

export async function preparePresalesExecution(
  projectId: string,
  requirementId: string
): Promise<PreparedPresalesExecution> {
  if (!projectId || !requirementId) {
    throw new PresalesExecutionError('缺少必要参数', 400, 'MISSING_ARGUMENT')
  }

  assertUuidLike(projectId, 'projectId')
  assertUuidLike(requirementId, 'requirementId')

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    throw new PresalesExecutionError('请先登录', 401, 'UNAUTHORIZED')
  }

  const [projectResult, requirementResult, configResult] = await Promise.all([
    supabase
      .from('projects')
      .select('id, description, status')
      .eq('id', projectId)
      .eq('created_by', user.id)
      .maybeSingle(),
    supabase
      .from('requirements')
      .select('id, project_id, raw_content')
      .eq('id', requirementId)
      .eq('project_id', projectId)
      .maybeSingle(),
    supabase
      .from('system_config')
      .select('default_labor_cost_per_day, default_risk_buffer_percentage, currency')
      .limit(1)
      .maybeSingle(),
  ])

  if (projectResult.error) {
    throw new PresalesExecutionError(`查询项目失败: ${projectResult.error.message}`, 500)
  }
  if (!projectResult.data) {
    throw new PresalesExecutionError('项目不存在或无权限访问', 404, 'PROJECT_NOT_FOUND')
  }
  if (projectResult.data.status === 'archived') {
    throw new PresalesExecutionError('归档项目不能执行分析', 400, 'PROJECT_ARCHIVED')
  }
  if (requirementResult.error) {
    throw new PresalesExecutionError(`查询需求失败: ${requirementResult.error.message}`, 500)
  }
  if (!requirementResult.data) {
    throw new PresalesExecutionError('需求不存在、无权限或不属于该项目', 404, 'REQUIREMENT_NOT_FOUND')
  }
  if (!requirementResult.data.raw_content?.trim()) {
    throw new PresalesExecutionError('需求内容为空', 400, 'EMPTY_REQUIREMENT')
  }

  if (configResult.error) {
    throw new PresalesExecutionError(`查询成本配置失败: ${configResult.error.message}`, 500)
  }

  const dbConfig = configResult.data
  return {
    supabase,
    userId: user.id,
    projectId,
    requirementId,
    rawRequirement: requirementResult.data.raw_content,
    projectDescription: projectResult.data.description || '',
    previousProjectStatus: projectResult.data.status as ProjectStatus,
    systemConfig: {
      laborCostPerDay: numericConfigValue(
        dbConfig?.default_labor_cost_per_day,
        DEFAULT_CONFIG.LABOR_COST_PER_DAY
      ),
      riskBufferPercentage: numericConfigValue(
        dbConfig?.default_risk_buffer_percentage,
        DEFAULT_CONFIG.RISK_BUFFER_PERCENTAGE
      ),
      workingHoursPerDay: DEFAULT_CONFIG.WORKING_HOURS_PER_DAY,
      currency: dbConfig?.currency || DEFAULT_CONFIG.CURRENCY,
    },
  }
}

export async function beginPresalesExecution(
  prepared: PreparedPresalesExecution,
  transport: PresalesTransport
): Promise<PresalesExecutionHandle> {
  const { data, error } = await prepared.supabase.rpc('begin_presales_execution', {
    p_project_id: prepared.projectId,
    p_requirement_id: prepared.requirementId,
    p_agent_type: 'presales_estimation',
    p_input_data: {
      projectId: prepared.projectId,
      requirementId: prepared.requirementId,
      transport,
      requirementLength: prepared.rawRequirement.length,
      projectDescriptionLength: prepared.projectDescription.length,
      systemConfig: prepared.systemConfig,
    },
  })

  throwRpcError(error, '创建执行记录失败')
  if (!data) {
    throw new PresalesExecutionError('创建执行记录失败', 500)
  }

  return {
    executionId: data as string,
    prepared,
    startedAt: Date.now(),
    transport,
  }
}

export function buildPresalesPersistenceSnapshot(
  result: WorkflowResult,
  prepared: PreparedPresalesExecution
): PresalesPersistenceSnapshot {
  if (!result.success || !result.analysis || !result.estimation || !result.cost) {
    throw new PresalesExecutionError(result.error || '工作流结果不完整，不能保存', 500)
  }

  const staffingByRoleMap = new Map(
    result.cost.staffingByRole.map((role) => [role.role, role.totalDays])
  )

  return {
    parsedRequirement: result.analysis,
    functionModules: result.functions.map((fn) => ({
      module_name: fn.moduleName,
      function_name: fn.functionName,
      description: fn.description,
      difficulty_level: fn.difficultyLevel,
      estimated_hours: fn.roleEstimates.reduce(
        (sum, role) => sum + role.days * prepared.systemConfig.workingHoursPerDay,
        0
      ),
      dependencies: fn.dependencies || null,
      role_estimates: fn.roleEstimates,
    })),
    projectRoles: result.identifiedRoles.map((role) => ({
      role_name: role.role,
      responsibility: role.responsibility,
      headcount: role.headcount,
      total_days: staffingByRoleMap.get(role.role) || 0,
    })),
    additionalWorkItems: result.additionalWork.map((work) => ({
      work_item: work.workItem,
      days: work.days,
      assigned_roles: work.assignedRoles,
    })),
    costEstimate: {
      labor_cost: result.cost.laborCost,
      service_cost: result.cost.serviceCost,
      infrastructure_cost: result.cost.infrastructureCost,
      buffer_percentage: (result.cost.bufferCoefficient - 1) * 100,
      total_cost: result.cost.totalCost,
      base_days: result.cost.baseDays,
      buffered_days: result.cost.bufferedDays,
      buffer_coefficient: result.cost.bufferCoefficient,
      rule_version: result.cost.ruleVersion,
      service_policy_version: result.cost.servicePolicyVersion,
      currency: result.cost.currency,
      labor_cost_per_day: result.cost.laborCostPerDay,
      working_hours_per_day: result.cost.workingHoursPerDay,
      breakdown: {
        roleBreakdown: result.cost.roleBreakdown,
        additionalWorkBreakdown: result.cost.additionalWorkBreakdown,
        thirdPartyServices: result.cost.thirdPartyServices,
        ruleVersion: result.cost.ruleVersion,
        servicePolicyVersion: result.cost.servicePolicyVersion,
        currency: result.cost.currency,
        laborCostPerDay: result.cost.laborCostPerDay,
        workingHoursPerDay: result.cost.workingHoursPerDay,
        bufferDays: result.cost.bufferDays,
        estimatedDurationDays: result.cost.estimatedDurationDays,
        reconciliation: result.cost.reconciliation,
      },
    },
    outputData: result,
  }
}

export async function completePresalesExecution(
  handle: PresalesExecutionHandle,
  result: WorkflowResult
): Promise<void> {
  const snapshot = buildPresalesPersistenceSnapshot(result, handle.prepared)
  const { error } = await handle.prepared.supabase.rpc('commit_presales_execution', {
    p_execution_id: handle.executionId,
    p_snapshot: snapshot,
    p_execution_time_ms: Date.now() - handle.startedAt,
  })

  throwRpcError(error, '保存分析结果失败')
}

export async function finishPresalesExecution(
  handle: PresalesExecutionHandle,
  status: PresalesExecutionTerminalStatus,
  error: unknown
): Promise<void> {
  const { error: rpcError } = await handle.prepared.supabase.rpc('finish_presales_execution', {
    p_execution_id: handle.executionId,
    p_status: status,
    p_error_message: getErrorMessage(error, status === 'cancelled' ? '用户取消执行' : '执行失败'),
    p_execution_time_ms: Date.now() - handle.startedAt,
  })

  if (rpcError) {
    console.error('[Execution] 更新执行终态失败:', rpcError)
  }
}

export function classifyExecutionError(
  error: unknown,
  signal?: AbortSignal
): PresalesExecutionTerminalStatus {
  if (isTimeoutError(error, signal)) return 'timed_out'
  if (isAbortError(error, signal)) return 'cancelled'
  return 'failed'
}

export async function executePreparedPresalesWorkflow(
  handle: PresalesExecutionHandle,
  options: WorkflowRunOptions = {}
): Promise<WorkflowResult> {
  const { prepared } = handle

  return withLangfuseTrace(
    'presales-workflow',
    {
      input: {
        projectId: prepared.projectId,
        requirementId: prepared.requirementId,
        requirementLength: prepared.rawRequirement.length,
      },
      metadata: {
        executionId: handle.executionId,
        userId: prepared.userId,
        transport: handle.transport,
      },
    },
    async (observation) => {
      try {
        const result = await runPresalesWorkflow(
          prepared.projectId,
          prepared.requirementId,
          prepared.rawRequirement,
          prepared.projectDescription,
          prepared.systemConfig,
          {
            ...options,
            executionId: handle.executionId,
            timeoutMs: options.timeoutMs ?? EXECUTION_POLICY.presalesRouteTimeoutMs,
          }
        )

        observation?.update({
          output: { success: result.success, functionsCount: result.functions.length },
          level: result.success ? 'DEFAULT' : 'ERROR',
          statusMessage: result.error || undefined,
        })
        return result
      } catch (error) {
        observation?.update({
          level: isAbortError(error, options.signal) ? 'WARNING' : 'ERROR',
          statusMessage: getErrorMessage(error, '工作流执行失败'),
        })
        throw error
      }
    }
  )
}

export async function* streamPreparedPresalesWorkflow(
  handle: PresalesExecutionHandle,
  options: WorkflowRunOptions = {}
): AsyncIterable<{ step: string; state: Partial<PresalesState> }> {
  const { prepared } = handle

  yield* streamPresalesWorkflow(
    prepared.projectId,
    prepared.requirementId,
    prepared.rawRequirement,
    prepared.projectDescription,
    prepared.systemConfig,
    {
      ...options,
      executionId: handle.executionId,
      timeoutMs: options.timeoutMs ?? EXECUTION_POLICY.presalesRouteTimeoutMs,
    }
  )
}
