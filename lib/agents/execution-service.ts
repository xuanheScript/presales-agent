import { DEFAULT_CONFIG } from '@/constants'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { withLangfuseTrace } from '@/lib/observability/langfuse'
import {
  EXECUTION_POLICY,
  getErrorMessage,
  isAbortError,
  type WorkflowRunOptions,
} from './execution-policy'
import {
  PresalesExecutionError,
  classifyExecutionError,
  type PresalesExecutionTerminalStatus,
} from './execution-errors'
import { buildPresalesPersistenceSnapshot } from './persistence-snapshot'
import { runPresalesWorkflow, streamPresalesWorkflow } from './graph'
import { getAnalysisPromptSnapshot } from './nodes/analyze'
import type {
  WorkflowResult,
  WorkflowSystemConfig,
  PresalesState,
} from './state'
import type { ProjectStatus } from '@/types'

export type PresalesTransport = 'run' | 'stream'

export {
  PresalesExecutionError,
  buildPresalesPersistenceSnapshot,
  classifyExecutionError,
}

export interface PreparedPresalesExecution {
  userId: string
  projectId: string
  requirementBaselineId: string
  requirementBaselineRevision: number
  requirementBaselineContentHash: string
  canonicalRequirement: string
  projectDescription: string
  analysisPromptTemplate: string
  previousProjectStatus: ProjectStatus
  systemConfig: WorkflowSystemConfig
  provenance: PresalesExecutionProvenance
}

export interface PresalesExecutionProvenance {
  modelId: string
  workflowVersion: 'presales-workflow-v1'
  promptVersions: {
    analysis: string
    breakdown: 'batched_structured_v2'
    estimate: 'buffer-estimation-v1'
    calculate: 'formal-workflow-v1'
  }
  outputSchemaVersion: 'presales-estimate-v1'
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
  existingEstimateVersionId: string | null
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
  requirementBaselineId: string
): Promise<PreparedPresalesExecution> {
  if (!projectId || !requirementBaselineId) {
    throw new PresalesExecutionError('缺少必要参数', 400, 'MISSING_ARGUMENT')
  }

  assertUuidLike(projectId, 'projectId')
  assertUuidLike(requirementBaselineId, 'requirementBaselineId')

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    throw new PresalesExecutionError('请先登录', 401, 'UNAUTHORIZED')
  }

  const [projectResult, baselineResult, configResult] = await Promise.all([
    supabase
      .from('projects')
      .select('id, status, current_requirement_baseline_id')
      .eq('id', projectId)
      .eq('created_by', user.id)
      .maybeSingle(),
    supabase
      .from('requirement_baselines')
      .select('id, project_id, revision_no, canonical_content, content_hash, project_description_snapshot')
      .eq('id', requirementBaselineId)
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
  if (projectResult.data.current_requirement_baseline_id !== requirementBaselineId) {
    throw new PresalesExecutionError('请求的需求基线不是项目当前已确认基线', 409, 'BASELINE_CONFLICT')
  }
  if (baselineResult.error) {
    throw new PresalesExecutionError(`查询需求基线失败: ${baselineResult.error.message}`, 500)
  }
  if (!baselineResult.data) {
    throw new PresalesExecutionError('需求基线不存在、无权限或不属于该项目', 404, 'BASELINE_NOT_FOUND')
  }
  if (!baselineResult.data.canonical_content?.trim()) {
    throw new PresalesExecutionError('需求基线内容为空', 400, 'EMPTY_BASELINE')
  }

  if (configResult.error) {
    throw new PresalesExecutionError(`查询成本配置失败: ${configResult.error.message}`, 500)
  }

  const dbConfig = configResult.data
  const analysisPrompt = await getAnalysisPromptSnapshot()
  const systemConfig = {
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
  }

  return {
    userId: user.id,
    projectId,
    requirementBaselineId,
    requirementBaselineRevision: baselineResult.data.revision_no,
    requirementBaselineContentHash: baselineResult.data.content_hash,
    canonicalRequirement: baselineResult.data.canonical_content,
    projectDescription: baselineResult.data.project_description_snapshot || '',
    analysisPromptTemplate: analysisPrompt.content,
    previousProjectStatus: projectResult.data.status as ProjectStatus,
    systemConfig,
    provenance: {
      modelId: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      workflowVersion: 'presales-workflow-v1',
      promptVersions: {
        analysis: analysisPrompt.version,
        breakdown: 'batched_structured_v2',
        estimate: 'buffer-estimation-v1',
        calculate: 'formal-workflow-v1',
      },
      outputSchemaVersion: 'presales-estimate-v1',
    },
  }
}

export async function preparePresalesExecutionForWorker(
  actorUserId: string,
  projectId: string,
  requirementBaselineId: string
): Promise<PreparedPresalesExecution> {
  assertUuidLike(actorUserId, 'actorUserId')
  assertUuidLike(projectId, 'projectId')
  assertUuidLike(requirementBaselineId, 'requirementBaselineId')

  const supabase = createAdminClient()
  const [projectResult, baselineResult, configResult] = await Promise.all([
    supabase
      .from('projects')
      .select('id, status, created_by, current_requirement_baseline_id')
      .eq('id', projectId)
      .eq('created_by', actorUserId)
      .maybeSingle(),
    supabase
      .from('requirement_baselines')
      .select('id, project_id, revision_no, canonical_content, content_hash, project_description_snapshot')
      .eq('id', requirementBaselineId)
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
    throw new PresalesExecutionError('项目不存在或执行发起用户无权访问', 404, 'PROJECT_NOT_FOUND')
  }
  if (projectResult.data.status === 'archived') {
    throw new PresalesExecutionError('归档项目不能执行分析', 400, 'PROJECT_ARCHIVED')
  }
  if (projectResult.data.current_requirement_baseline_id !== requirementBaselineId) {
    throw new PresalesExecutionError('请求的需求基线不是项目当前已确认基线', 409, 'BASELINE_CONFLICT')
  }
  if (baselineResult.error) {
    throw new PresalesExecutionError(`查询需求基线失败: ${baselineResult.error.message}`, 500)
  }
  if (!baselineResult.data) {
    throw new PresalesExecutionError('需求基线不存在或与项目不匹配', 404, 'BASELINE_NOT_FOUND')
  }
  if (!baselineResult.data.canonical_content?.trim()) {
    throw new PresalesExecutionError('需求基线内容为空', 400, 'EMPTY_BASELINE')
  }
  if (configResult.error) {
    throw new PresalesExecutionError(`查询成本配置失败: ${configResult.error.message}`, 500)
  }

  const analysisPrompt = await getAnalysisPromptSnapshot()
  const dbConfig = configResult.data
  return {
    userId: actorUserId,
    projectId,
    requirementBaselineId,
    requirementBaselineRevision: baselineResult.data.revision_no,
    requirementBaselineContentHash: baselineResult.data.content_hash,
    canonicalRequirement: baselineResult.data.canonical_content,
    projectDescription: baselineResult.data.project_description_snapshot || '',
    analysisPromptTemplate: analysisPrompt.content,
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
    provenance: {
      modelId: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      workflowVersion: 'presales-workflow-v1',
      promptVersions: {
        analysis: analysisPrompt.version,
        breakdown: 'batched_structured_v2',
        estimate: 'buffer-estimation-v1',
        calculate: 'formal-workflow-v1',
      },
      outputSchemaVersion: 'presales-estimate-v1',
    },
  }
}

export async function beginPresalesExecution(
  prepared: PreparedPresalesExecution,
  transport: PresalesTransport,
  orchestrationRunId?: string
): Promise<PresalesExecutionHandle> {
  const adminSupabase = createAdminClient()
  const { data, error } = await adminSupabase.rpc('begin_presales_execution', {
    p_actor_user_id: prepared.userId,
    p_project_id: prepared.projectId,
    p_requirement_baseline_id: prepared.requirementBaselineId,
    p_agent_type: 'presales_estimation',
    p_input_data: {
      projectId: prepared.projectId,
      requirementBaselineId: prepared.requirementBaselineId,
      requirementBaselineRevision: prepared.requirementBaselineRevision,
      requirementBaselineContentHash: prepared.requirementBaselineContentHash,
      transport,
      orchestrationRunId: orchestrationRunId || null,
      previousProjectStatus: prepared.previousProjectStatus,
      requirementLength: prepared.canonicalRequirement.length,
      projectDescriptionLength: prepared.projectDescription.length,
    },
    p_system_config: prepared.systemConfig,
    p_model_id: prepared.provenance.modelId,
    p_workflow_version: prepared.provenance.workflowVersion,
    p_prompt_versions: prepared.provenance.promptVersions,
    p_output_schema_version: prepared.provenance.outputSchemaVersion,
  })

  throwRpcError(error, '创建执行记录失败')
  if (!data) {
    throw new PresalesExecutionError('创建执行记录失败', 500)
  }

  const executionId = data as string
  let existingEstimateVersionId: string | null = null
  if (orchestrationRunId) {
    const { data: existing, error: existingError } = await adminSupabase
      .from('agent_executions')
      .select('status, estimate_version_id, requested_by, requirement_baseline_id')
      .eq('id', executionId)
      .maybeSingle()
    if (existingError) {
      throw new PresalesExecutionError(`读取执行状态失败: ${existingError.message}`, 500)
    }
    if (
      existing?.requested_by !== prepared.userId
      || existing?.requirement_baseline_id !== prepared.requirementBaselineId
    ) {
      throw new PresalesExecutionError('幂等执行记录与当前请求不匹配', 409, 'EXECUTION_CONFLICT')
    }
    if (existing.status === 'completed' && existing.estimate_version_id) {
      existingEstimateVersionId = existing.estimate_version_id
    }
  }

  return {
    executionId,
    existingEstimateVersionId,
    prepared,
    startedAt: Date.now(),
    transport,
  }
}

export async function completePresalesExecution(
  handle: PresalesExecutionHandle,
  result: WorkflowResult
): Promise<string> {
  const snapshot = buildPresalesPersistenceSnapshot(result, handle.prepared)
  const adminSupabase = createAdminClient()
  const { data, error } = await adminSupabase.rpc('commit_presales_execution', {
    p_actor_user_id: handle.prepared.userId,
    p_execution_id: handle.executionId,
    p_snapshot: snapshot,
    p_execution_time_ms: Date.now() - handle.startedAt,
  })

  throwRpcError(error, '保存分析结果失败')
  if (typeof data !== 'string') {
    throw new PresalesExecutionError('数据库未返回估算版本 ID', 500, 'INVALID_COMMIT_RESULT')
  }
  return data
}

export async function finishPresalesExecution(
  handle: PresalesExecutionHandle,
  status: PresalesExecutionTerminalStatus,
  error: unknown
): Promise<void> {
  const params = {
    p_actor_user_id: handle.prepared.userId,
    p_execution_id: handle.executionId,
    p_status: status,
    p_error_message: getErrorMessage(error, status === 'cancelled' ? '用户取消执行' : '执行失败'),
    p_execution_time_ms: Date.now() - handle.startedAt,
  }
  const adminSupabase = createAdminClient()
  let lastError: unknown

  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error: rpcError } = await adminSupabase.rpc(
      'finish_presales_execution',
      params
    )
    if (!rpcError) return

    lastError = rpcError
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 200))
    }
  }

  console.error('[Execution] 更新执行终态失败，重试已耗尽:', lastError)
  throw new PresalesExecutionError(
    '分析已结束，但执行状态保存失败，请稍后重试',
    503,
    'EXECUTION_FINALIZATION_FAILED'
  )
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
        requirementBaselineId: prepared.requirementBaselineId,
        requirementLength: prepared.canonicalRequirement.length,
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
          prepared.requirementBaselineId,
          prepared.canonicalRequirement,
          prepared.projectDescription,
          prepared.systemConfig,
          {
            ...options,
            executionId: handle.executionId,
            timeoutMs: options.timeoutMs ?? EXECUTION_POLICY.presalesRouteTimeoutMs,
          },
          prepared.analysisPromptTemplate
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
    prepared.requirementBaselineId,
    prepared.canonicalRequirement,
    prepared.projectDescription,
    prepared.systemConfig,
    {
      ...options,
      executionId: handle.executionId,
      timeoutMs: options.timeoutMs ?? EXECUTION_POLICY.presalesRouteTimeoutMs,
    },
    prepared.analysisPromptTemplate
  )
}
