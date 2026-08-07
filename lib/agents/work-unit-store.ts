import { createHash } from 'node:crypto'
import type {
  FullDocumentCapacityPlan,
  FullDocumentDiscoveryResult,
  ModelCallMetrics,
} from './nodes/full-document-discovery'
import { createAdminClient } from '@/lib/supabase/admin'

export type PresalesWorkUnitStage = 'full_document_discovery'

export interface PresalesExecutionIdentity {
  requestedBy: string
  projectId: string
  requirementBaselineId: string
  requirementBaselineContentHash: string
}

export interface ClaimedPresalesExecution {
  executionId: string
  leaseToken: string
  leaseGeneration: number
}

export interface PresalesExecutionLease {
  actorUserId: string
  executionId: string
  workerId: string
  leaseToken: string
  leaseGeneration: number
}

export interface ClaimedPresalesWorkUnit {
  id: string
  unitKey: string
  sourceId: string | null
  inputHash: string
  input: Record<string, unknown>
  leaseToken: string
  leaseGeneration: number
  attempt: number
  maxAttempts: number
}

export interface PresalesWorkUnitRecord {
  id: string
  unit_key: string
  status: string
  input_hash: string
  input_payload: Record<string, unknown>
  output_payload: Record<string, unknown> | null
  output_hash: string | null
  retry_at: string | null
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`
}

export function hashWorkUnitValue(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function throwStoreError(error: { message: string } | null, fallback: string): void {
  if (error) throw new Error(error.message || fallback)
}

export async function findPresalesExecutionByRunId(
  orchestrationRunId: string
): Promise<(PresalesExecutionIdentity & {
  executionId: string
  status: string
  workerId: string | null
}) | null> {
  const { data, error } = await createAdminClient()
    .from('agent_executions')
    .select('id, status, requested_by, project_id, requirement_baseline_id, requirement_baseline_content_hash, leased_by')
    .eq('orchestration_run_id', orchestrationRunId)
    .in('status', ['running', 'completed'])
    .maybeSingle()
  throwStoreError(error, '读取售前执行记录失败')
  if (!data) return null
  return {
    executionId: data.id,
    status: data.status,
    requestedBy: data.requested_by,
    projectId: data.project_id,
    requirementBaselineId: data.requirement_baseline_id,
    requirementBaselineContentHash: data.requirement_baseline_content_hash,
    workerId: data.leased_by,
  }
}

export async function finalizePresalesExecutionByRunId(input: {
  orchestrationRunId: string
  status: 'failed' | 'cancelled' | 'timed_out'
  errorMessage: string
}): Promise<void> {
  const execution = await findPresalesExecutionByRunId(input.orchestrationRunId)
  if (!execution || execution.status !== 'running' || !execution.workerId) return
  const lease = await claimPresalesExecution({
    actorUserId: execution.requestedBy,
    executionId: execution.executionId,
    workerId: execution.workerId,
    leaseSeconds: 300,
  })
  const { error } = await createAdminClient().rpc('finalize_presales_execution', {
    p_actor_user_id: execution.requestedBy,
    p_execution_id: execution.executionId,
    p_execution_lease_token: lease.leaseToken,
    p_execution_lease_generation: lease.leaseGeneration,
    p_worker_id: lease.workerId,
    p_status: input.status,
    p_error_message: input.errorMessage,
    p_execution_time_ms: 0,
  })
  throwStoreError(error, '结束售前执行失败')
}

export async function initializePresalesExecutionPlan(input: {
  actorUserId: string
  executionId: string
  baselineId: string
  contentHash: string
  capacityPlan: FullDocumentCapacityPlan
  profileVersion: string
  discoveryVersion: string
  promptBundleHash: string
}): Promise<void> {
  const manifest = {
    version: input.discoveryVersion,
    baselineId: input.baselineId,
    contentHash: input.contentHash,
    capacityPlan: input.capacityPlan,
    plannedCalls: 1,
  }
  const discoveryInput = {
    baselineId: input.baselineId,
    contentHash: input.contentHash,
    discoveryVersion: input.discoveryVersion,
    capacityPlan: input.capacityPlan,
  }
  const { error } = await createAdminClient().rpc('initialize_presales_execution_plan', {
    p_actor_user_id: input.actorUserId,
    p_execution_id: input.executionId,
    p_manifest: manifest,
    p_manifest_hash: hashWorkUnitValue(manifest),
    p_model_profile_version: input.profileVersion,
    p_prompt_bundle_hash: input.promptBundleHash,
    p_discovery_input: discoveryInput,
    p_discovery_input_hash: hashWorkUnitValue(discoveryInput),
  })
  throwStoreError(error, '初始化售前执行计划失败')
}

export async function claimPresalesExecution(input: {
  actorUserId: string
  executionId: string
  workerId: string
  leaseSeconds?: number
}): Promise<PresalesExecutionLease> {
  const { data, error } = await createAdminClient().rpc('claim_presales_execution', {
    p_actor_user_id: input.actorUserId,
    p_execution_id: input.executionId,
    p_worker_id: input.workerId,
    p_lease_seconds: input.leaseSeconds ?? 300,
  })
  throwStoreError(error, '领取售前执行失败')
  const claim = data as ClaimedPresalesExecution | null
  if (!claim) throw new Error('领取售前执行未返回租约')
  return {
    actorUserId: input.actorUserId,
    executionId: claim.executionId,
    workerId: input.workerId,
    leaseToken: claim.leaseToken,
    leaseGeneration: claim.leaseGeneration,
  }
}

export async function claimPresalesWorkUnit(input: {
  lease: PresalesExecutionLease
  stage: PresalesWorkUnitStage
  leaseSeconds?: number
}): Promise<ClaimedPresalesWorkUnit | null> {
  const { data, error } = await createAdminClient().rpc('claim_presales_work_unit', {
    p_actor_user_id: input.lease.actorUserId,
    p_execution_id: input.lease.executionId,
    p_execution_lease_token: input.lease.leaseToken,
    p_execution_lease_generation: input.lease.leaseGeneration,
    p_stage: input.stage,
    p_worker_id: input.lease.workerId,
    p_lease_seconds: input.leaseSeconds ?? 300,
  })
  throwStoreError(error, '领取售前工作单元失败')
  return data as ClaimedPresalesWorkUnit | null
}

export async function heartbeatPresalesExecution(input: {
  lease: PresalesExecutionLease
  stage: string
  progressPercent: number
  leaseSeconds?: number
}): Promise<void> {
  const { error } = await createAdminClient().rpc('heartbeat_presales_execution', {
    p_actor_user_id: input.lease.actorUserId,
    p_execution_id: input.lease.executionId,
    p_lease_token: input.lease.leaseToken,
    p_lease_generation: input.lease.leaseGeneration,
    p_worker_id: input.lease.workerId,
    p_stage: input.stage,
    p_progress_percent: input.progressPercent,
    p_lease_seconds: input.leaseSeconds ?? 300,
  })
  throwStoreError(error, '更新售前执行心跳失败')
}

export async function heartbeatPresalesWorkUnit(input: {
  lease: PresalesExecutionLease
  workUnit: ClaimedPresalesWorkUnit
  leaseSeconds?: number
}): Promise<void> {
  const { error } = await createAdminClient().rpc('heartbeat_presales_work_unit', {
    p_execution_id: input.lease.executionId,
    p_execution_lease_token: input.lease.leaseToken,
    p_execution_lease_generation: input.lease.leaseGeneration,
    p_work_unit_id: input.workUnit.id,
    p_lease_token: input.workUnit.leaseToken,
    p_lease_generation: input.workUnit.leaseGeneration,
    p_worker_id: input.lease.workerId,
    p_lease_seconds: input.leaseSeconds ?? 300,
  })
  throwStoreError(error, '更新售前工作单元心跳失败')
}

export async function completePresalesWorkUnit(input: {
  lease: PresalesExecutionLease
  workUnit: ClaimedPresalesWorkUnit
  output: Record<string, unknown>
  metrics: ModelCallMetrics
}): Promise<void> {
  const { error } = await createAdminClient().rpc('complete_presales_work_unit', {
    p_execution_id: input.lease.executionId,
    p_execution_lease_token: input.lease.leaseToken,
    p_execution_lease_generation: input.lease.leaseGeneration,
    p_work_unit_id: input.workUnit.id,
    p_lease_token: input.workUnit.leaseToken,
    p_lease_generation: input.workUnit.leaseGeneration,
    p_worker_id: input.lease.workerId,
    p_output_payload: input.output,
    p_output_hash: hashWorkUnitValue(input.output),
    p_input_tokens: input.metrics.inputTokens,
    p_output_tokens: input.metrics.outputTokens,
    p_latency_ms: input.metrics.latencyMs,
    p_finish_reason: input.metrics.finishReason,
  })
  throwStoreError(error, '完成售前工作单元失败')
}

export async function failPresalesWorkUnit(input: {
  lease: PresalesExecutionLease
  workUnit: ClaimedPresalesWorkUnit
  errorCode: string
  errorMessage: string
  retryable: boolean
  retryDelaySeconds?: number
}): Promise<'retry_wait' | 'failed'> {
  const { data, error } = await createAdminClient().rpc('fail_presales_work_unit', {
    p_execution_id: input.lease.executionId,
    p_execution_lease_token: input.lease.leaseToken,
    p_execution_lease_generation: input.lease.leaseGeneration,
    p_work_unit_id: input.workUnit.id,
    p_lease_token: input.workUnit.leaseToken,
    p_lease_generation: input.workUnit.leaseGeneration,
    p_worker_id: input.lease.workerId,
    p_error_code: input.errorCode,
    p_error_message: input.errorMessage,
    p_retryable: input.retryable,
    p_retry_delay_seconds: input.retryDelaySeconds ?? 30,
  })
  throwStoreError(error, '结束售前工作单元失败')
  return data as 'retry_wait' | 'failed'
}

export async function recordPresalesModelCall(input: {
  lease: PresalesExecutionLease
  workUnit: ClaimedPresalesWorkUnit | null
  projectId: string
  callKey: string
  stage: PresalesWorkUnitStage
  attempt: number
  profileVersion: string
  providerOptions: unknown
  metrics: ModelCallMetrics
}): Promise<void> {
  const { metrics } = input
  const { error } = await createAdminClient().rpc('record_presales_model_call', {
    p_execution_id: input.lease.executionId,
    p_execution_lease_token: input.lease.leaseToken,
    p_execution_lease_generation: input.lease.leaseGeneration,
    p_worker_id: input.lease.workerId,
    p_work_unit_id: input.workUnit?.id ?? null,
    p_work_unit_lease_token: input.workUnit?.leaseToken ?? null,
    p_work_unit_lease_generation: input.workUnit?.leaseGeneration ?? null,
    p_project_id: input.projectId,
    p_call_key: input.callKey,
    p_stage: input.stage,
    p_attempt: input.attempt,
    p_configured_model_id: metrics.configuredModelId,
    p_response_model_id: metrics.responseModelId,
    p_response_id: metrics.responseId,
    p_model_profile_version: input.profileVersion,
    p_provider_options_hash: hashWorkUnitValue(input.providerOptions),
    p_finish_reason: metrics.finishReason,
    p_raw_finish_reason: metrics.rawFinishReason,
    p_input_tokens: metrics.inputTokens,
    p_output_tokens: metrics.outputTokens,
    p_total_tokens: metrics.totalTokens,
    p_latency_ms: metrics.latencyMs,
    p_empty_output: metrics.emptyOutput,
    p_structured_output_error: metrics.structuredOutputError,
    p_provider_metadata: metrics.providerMetadata,
  })
  throwStoreError(error, '记录售前模型调用失败')
}

export async function listPresalesWorkUnits(
  executionId: string,
  stage: PresalesWorkUnitStage
): Promise<PresalesWorkUnitRecord[]> {
  const { data, error } = await createAdminClient()
    .from('presales_execution_work_units')
    .select('id, unit_key, status, input_hash, input_payload, output_payload, output_hash, retry_at')
    .eq('execution_id', executionId)
    .eq('stage', stage)
    .order('created_at', { ascending: true })
  throwStoreError(error, '读取售前工作单元失败')
  return (data || []) as PresalesWorkUnitRecord[]
}

export async function loadSucceededFullDocumentDiscovery(
  executionId: string
): Promise<FullDocumentDiscoveryResult | null> {
  const records = await listPresalesWorkUnits(executionId, 'full_document_discovery')
  const succeeded = records.filter((record) => record.status === 'succeeded')
  if (succeeded.length === 0) return null
  if (succeeded.length !== 1 || succeeded[0].unit_key !== 'global') {
    throw new Error('全文需求分析成功工作单元数量无效')
  }
  const record = succeeded[0]
  if (!record.output_payload || !record.output_hash) {
    throw new Error('全文需求分析成功工作单元缺少输出')
  }
  if (hashWorkUnitValue(record.output_payload) !== record.output_hash) {
    throw new Error('全文需求分析工作单元输出哈希不一致')
  }
  const analysis = record.output_payload.analysis
  const functions = record.output_payload.functions
  if (!analysis || typeof analysis !== 'object' || !Array.isArray(functions)) {
    throw new Error('全文需求分析持久化输出无效')
  }
  return {
    analysis: analysis as FullDocumentDiscoveryResult['analysis'],
    functions: functions as FullDocumentDiscoveryResult['functions'],
    metrics: {
      configuredModelId: '',
      responseModelId: null,
      responseId: null,
      finishReason: 'stop',
      rawFinishReason: null,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
      emptyOutput: false,
      structuredOutputError: false,
      providerMetadata: null,
    },
  }
}
