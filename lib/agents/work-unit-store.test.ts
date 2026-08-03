import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FullDocumentDiscoveryResult } from './nodes/full-document-discovery'

const admin = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => admin,
}))

import {
  completePresalesWorkUnit,
  hashWorkUnitValue,
  initializePresalesExecutionPlan,
  loadSucceededFullDocumentDiscovery,
  recordPresalesModelCall,
} from './work-unit-store'

const lease = {
  actorUserId: 'user-1',
  executionId: 'execution-1',
  workerId: 'worker-1',
  leaseToken: 'execution-token',
  leaseGeneration: 2,
}

const workUnit = {
  id: 'unit-1',
  unitKey: 'global',
  sourceId: null,
  inputHash: 'input-hash',
  input: {},
  leaseToken: 'unit-token',
  leaseGeneration: 3,
  attempt: 1,
  maxAttempts: 3,
}

const discovery = {
  analysis: {
    projectType: '管理系统',
    businessGoals: ['提升效率'],
    keyFeatures: ['订单管理'],
    techStack: ['Next.js'],
    nonFunctionalRequirements: {},
    risks: [],
  },
  functions: [{
    moduleName: '订单',
    functionName: '订单管理',
    description: '维护订单',
    difficultyLevel: 'medium' as const,
    roleEstimates: [],
    dependencies: [],
  }],
}

const metrics: FullDocumentDiscoveryResult['metrics'] = {
  configuredModelId: 'deepseek-v4-flash',
  responseModelId: 'deepseek-v4-flash',
  responseId: 'response-1',
  finishReason: 'stop',
  rawFinishReason: 'stop',
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  latencyMs: 20,
  emptyOutput: false,
  structuredOutputError: false,
  providerMetadata: null,
}

beforeEach(() => {
  admin.from.mockReset()
  admin.rpc.mockReset()
})

describe('work unit store', () => {
  it('工作单元哈希不受对象键顺序影响', () => {
    expect(hashWorkUnitValue({ a: 1, b: { c: 2 } })).toBe(
      hashWorkUnitValue({ b: { c: 2 }, a: 1 })
    )
  })

  it('初始化唯一全文 discovery/global 工作单元', async () => {
    admin.rpc.mockResolvedValue({ data: null, error: null })
    const capacityPlan = {
      estimatedInputTokens: 100,
      availableInputTokens: 842_000,
      reservedOutputTokens: 96_000,
      promptReserveTokens: 12_000,
      contextSafetyTokens: 50_000,
      contextWindowTokens: 1_000_000,
      fitsContextWindow: true,
      plannedModelCalls: 1 as const,
    }

    await initializePresalesExecutionPlan({
      actorUserId: 'user-1',
      executionId: 'execution-1',
      baselineId: 'baseline-1',
      contentHash: 'baseline-hash',
      capacityPlan,
      profileVersion: 'profile-v1',
      discoveryVersion: 'full-document-discovery-v1',
      promptBundleHash: 'prompt-hash',
    })

    expect(admin.rpc).toHaveBeenCalledWith(
      'initialize_presales_execution_plan',
      expect.objectContaining({
        p_discovery_input: expect.objectContaining({
          baselineId: 'baseline-1',
          contentHash: 'baseline-hash',
          discoveryVersion: 'full-document-discovery-v1',
        }),
        p_discovery_input_hash: expect.any(String),
      })
    )
  })

  it('加载唯一成功 artifact 时验证确定性输出哈希', async () => {
    const output = discovery
    const order = vi.fn().mockResolvedValue({
      data: [{
        id: 'unit-1',
        unit_key: 'global',
        status: 'succeeded',
        input_hash: 'input-hash',
        input_payload: {},
        output_payload: output,
        output_hash: hashWorkUnitValue(output),
        retry_at: null,
      }],
      error: null,
    })
    const stageEq = vi.fn().mockReturnValue({ order })
    const executionEq = vi.fn().mockReturnValue({ eq: stageEq })
    const select = vi.fn().mockReturnValue({ eq: executionEq })
    admin.from.mockReturnValue({ select })

    await expect(loadSucceededFullDocumentDiscovery('execution-1')).resolves.toMatchObject(discovery)
  })

  it('完成工作单元时携带双层 fencing 与输出哈希', async () => {
    admin.rpc.mockResolvedValue({ data: null, error: null })

    await completePresalesWorkUnit({
      lease,
      workUnit,
      output: discovery,
      metrics,
    })

    expect(admin.rpc).toHaveBeenCalledWith('complete_presales_work_unit', {
      p_execution_id: lease.executionId,
      p_execution_lease_token: lease.leaseToken,
      p_execution_lease_generation: lease.leaseGeneration,
      p_work_unit_id: workUnit.id,
      p_lease_token: workUnit.leaseToken,
      p_lease_generation: workUnit.leaseGeneration,
      p_worker_id: lease.workerId,
      p_output_payload: discovery,
      p_output_hash: hashWorkUnitValue(discovery),
      p_input_tokens: 10,
      p_output_tokens: 5,
      p_latency_ms: 20,
      p_finish_reason: 'stop',
    })
  })

  it('记录全文模型调用时持久化 execution 与 work-unit fencing', async () => {
    admin.rpc.mockResolvedValue({ data: null, error: null })

    await recordPresalesModelCall({
      lease,
      workUnit,
      projectId: 'project-1',
      callKey: 'full-document-discovery:global:attempt:1',
      stage: 'full_document_discovery',
      attempt: 1,
      profileVersion: 'profile-v1',
      providerOptions: {},
      metrics,
    })

    expect(admin.rpc).toHaveBeenCalledWith(
      'record_presales_model_call',
      expect.objectContaining({
        p_stage: 'full_document_discovery',
        p_execution_lease_generation: 2,
        p_work_unit_lease_generation: 3,
        p_input_tokens: 10,
        p_output_tokens: 5,
      })
    )
  })
})
