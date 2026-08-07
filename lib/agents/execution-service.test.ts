import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PresalesExecutionHandle } from './execution-service'

const admin = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => admin,
}))

vi.mock('@/lib/observability/langfuse', () => ({
  withLangfuseTrace: vi.fn(async (
    _name: string,
    _context: unknown,
    callback: (observation: { update: ReturnType<typeof vi.fn> }) => Promise<unknown>
  ) => callback({ update: vi.fn() })),
}))

vi.mock('./graph', () => ({
  runPresalesWorkflow: vi.fn(),
  streamPresalesWorkflow: vi.fn(),
}))

vi.mock('./persisted-full-document-discovery', () => ({
  runPersistedFullDocumentDiscovery: vi.fn(),
}))

vi.mock('./work-unit-store', () => ({
  claimPresalesExecution: vi.fn(),
  heartbeatPresalesExecution: vi.fn(),
}))

vi.mock('./nodes/analyze', () => ({
  getAnalysisPromptSnapshot: vi.fn(),
  getAnalysisPromptSnapshotForWorker: vi.fn(),
}))

import {
  executePreparedPresalesWorkflow,
  finishPresalesExecution,
} from './execution-service'
import { runPresalesWorkflow } from './graph'
import { runPersistedFullDocumentDiscovery } from './persisted-full-document-discovery'
import {
  claimPresalesExecution,
  heartbeatPresalesExecution,
} from './work-unit-store'

const lease = {
  actorUserId: '00000000-0000-4000-8000-000000000001',
  executionId: '00000000-0000-4000-8000-000000000002',
  workerId: 'worker-1',
  leaseToken: 'execution-token',
  leaseGeneration: 4,
}

function handle(): PresalesExecutionHandle {
  return {
    executionId: lease.executionId,
    existingEstimateVersionId: null,
    startedAt: Date.now(),
    transport: 'run',
    lease: null,
    prepared: {
      userId: lease.actorUserId,
      projectId: '00000000-0000-4000-8000-000000000003',
      requirementBaselineId: '00000000-0000-4000-8000-000000000004',
      requirementBaselineRevision: 1,
      requirementBaselineContentHash: 'baseline-hash',
      canonicalRequirement: '维护订单',
      projectDescription: '',
      analysisPromptTemplate: '分析需求',
      previousProjectStatus: 'draft',
      systemConfig: {
        laborCostPerDay: 1000,
        riskBufferPercentage: 10,
        workingHoursPerDay: 8,
        currency: 'CNY',
      },
      capacityPlan: {
        estimatedInputTokens: 10,
        availableInputTokens: 842_000,
        reservedOutputTokens: 96_000,
        promptReserveTokens: 12_000,
        contextSafetyTokens: 50_000,
        contextWindowTokens: 1_000_000,
        fitsContextWindow: true,
        plannedModelCalls: 1,
      },
      provenance: {
        modelId: 'deepseek-v4-flash',
        modelProfileVersion: 'deepseek-v4-non-thinking-v1',
        workflowVersion: 'presales-full-document-v1',
        promptVersions: {
          analysis: 'analysis-v1',
          breakdown: 'full_document_discovery_v1',
          estimate: 'buffer-estimation-v1',
          calculate: 'formal-workflow-v1',
        },
        outputSchemaVersion: 'presales-estimate-v1',
      },
    },
  }
}

beforeEach(() => {
  admin.rpc.mockReset()
  vi.mocked(claimPresalesExecution).mockReset()
  vi.mocked(heartbeatPresalesExecution).mockReset()
  vi.mocked(runPersistedFullDocumentDiscovery).mockReset()
  vi.mocked(runPresalesWorkflow).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('execution service lease fencing', () => {
  it('扩展阶段心跳失败时立即中止正在运行的工作流并拒绝提交结果', async () => {
    vi.useFakeTimers()
    const heartbeatError = new Error('执行租约已失效')
    let workflowSignal: AbortSignal | undefined

    vi.mocked(runPersistedFullDocumentDiscovery).mockImplementation(async (input) => {
      input.onLeaseClaimed?.(lease)
      return {
        analysis: {
          projectType: '管理系统',
          businessGoals: [],
          keyFeatures: [],
          techStack: [],
          nonFunctionalRequirements: {},
          risks: [],
        },
        functions: [{
          moduleName: '订单',
          functionName: '维护订单',
          description: '维护订单',
          difficultyLevel: 'medium',
          roleEstimates: [],
          dependencies: [],
        }],
        metrics: {
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
        },
      }
    })
    vi.mocked(heartbeatPresalesExecution).mockRejectedValue(heartbeatError)
    vi.mocked(runPresalesWorkflow).mockImplementation((
      _projectId,
      _baselineId,
      _requirement,
      _description,
      _systemConfig,
      options = {}
    ) => {
      workflowSignal = options.signal
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
          once: true,
        })
      })
    })

    const running = executePreparedPresalesWorkflow(handle(), {
      durableDiscovery: true,
      workerId: lease.workerId,
    })
    const rejection = expect(running).rejects.toBe(heartbeatError)
    await vi.waitFor(() => expect(runPresalesWorkflow).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(45_000)

    await rejection
    expect(workflowSignal?.aborted).toBe(true)
    expect(workflowSignal?.reason).toBe(heartbeatError)
  })

  it('普通终态写入携带当前 execution 租约 generation', async () => {
    admin.rpc.mockResolvedValue({ data: null, error: null })
    const execution = handle()
    execution.lease = lease
    const failure = new Error('工作流失败')

    await finishPresalesExecution(execution, 'failed', failure)

    expect(claimPresalesExecution).not.toHaveBeenCalled()
    expect(admin.rpc).toHaveBeenCalledWith('finish_presales_execution', {
      p_actor_user_id: lease.actorUserId,
      p_execution_id: lease.executionId,
      p_execution_lease_token: lease.leaseToken,
      p_execution_lease_generation: lease.leaseGeneration,
      p_worker_id: lease.workerId,
      p_status: 'failed',
      p_error_message: failure.message,
      p_execution_time_ms: expect.any(Number),
    })
  })
})
