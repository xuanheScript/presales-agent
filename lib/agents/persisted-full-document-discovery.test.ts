import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelGateway } from '@/lib/ai/model-gateway'
import type { PresalesState } from './state'

const store = vi.hoisted(() => ({
  claimPresalesExecution: vi.fn(),
  claimPresalesWorkUnit: vi.fn(),
  completePresalesWorkUnit: vi.fn(),
  failPresalesWorkUnit: vi.fn(),
  heartbeatPresalesExecution: vi.fn(),
  heartbeatPresalesWorkUnit: vi.fn(),
  loadSucceededFullDocumentDiscovery: vi.fn(),
  recordPresalesModelCall: vi.fn(),
}))
const discoverFullDocument = vi.hoisted(() => vi.fn())

vi.mock('./work-unit-store', () => store)
vi.mock('./nodes/full-document-discovery', () => ({
  discoverFullDocument,
}))

import { runPersistedFullDocumentDiscovery } from './persisted-full-document-discovery'

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
const metrics = {
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
  metrics,
}
const state = {
  projectId: 'project-1',
  requirementBaselineId: 'baseline-1',
  canonicalRequirement: '维护订单',
  projectDescription: '',
} as PresalesState
const gateway = {
  model: {},
  maxRetries: 0,
  profile: {
    id: 'deepseek-v4-flash',
    profileVersion: 'profile-v1',
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 384_000,
    recommendedConcurrency: 3,
    providerOptions: {},
  },
} as unknown as ModelGateway

function input() {
  return {
    actorUserId: lease.actorUserId,
    executionId: lease.executionId,
    workerId: lease.workerId,
    projectId: state.projectId,
    state,
    modelGateway: gateway,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  store.claimPresalesExecution.mockResolvedValue(lease)
  store.claimPresalesWorkUnit.mockResolvedValue(workUnit)
  store.completePresalesWorkUnit.mockResolvedValue(undefined)
  store.failPresalesWorkUnit.mockResolvedValue('failed')
  store.heartbeatPresalesExecution.mockResolvedValue(undefined)
  store.heartbeatPresalesWorkUnit.mockResolvedValue(undefined)
  store.loadSucceededFullDocumentDiscovery.mockResolvedValue(null)
  store.recordPresalesModelCall.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('runPersistedFullDocumentDiscovery', () => {
  it('复用成功 artifact，不再领取工作单元或调用模型', async () => {
    store.loadSucceededFullDocumentDiscovery.mockResolvedValue(discovery)

    await expect(runPersistedFullDocumentDiscovery(input())).resolves.toBe(discovery)

    expect(store.claimPresalesExecution).toHaveBeenCalledOnce()
    expect(store.claimPresalesWorkUnit).not.toHaveBeenCalled()
    expect(discoverFullDocument).not.toHaveBeenCalled()
    expect(store.heartbeatPresalesExecution).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'enriching',
      progressPercent: 55,
    }))
  })

  it('只调用一次全文模型并原子记录账本与成功产物', async () => {
    discoverFullDocument.mockResolvedValue(discovery)

    await expect(runPersistedFullDocumentDiscovery(input())).resolves.toBe(discovery)

    expect(discoverFullDocument).toHaveBeenCalledOnce()
    expect(store.recordPresalesModelCall).toHaveBeenCalledWith(expect.objectContaining({
      lease,
      workUnit,
      callKey: 'full-document-discovery:global:attempt:1',
      stage: 'full_document_discovery',
      metrics,
    }))
    expect(store.completePresalesWorkUnit).toHaveBeenCalledWith({
      lease,
      workUnit,
      output: {
        analysis: discovery.analysis,
        functions: discovery.functions,
      },
      metrics,
    })
    expect(store.failPresalesWorkUnit).not.toHaveBeenCalled()
  })

  it('带指标的瞬态失败会记账并进入工作单元重试', async () => {
    const failure = Object.assign(new Error('模型暂时不可用'), { metrics })
    discoverFullDocument.mockRejectedValue(failure)
    store.failPresalesWorkUnit.mockResolvedValue('retry_wait')

    await expect(runPersistedFullDocumentDiscovery(input()))
      .rejects.toThrow('全文需求分析暂时失败，将由后台任务重试')

    expect(store.recordPresalesModelCall).toHaveBeenCalledWith(expect.objectContaining({
      metrics,
      attempt: 1,
    }))
    expect(store.failPresalesWorkUnit).toHaveBeenCalledWith(expect.objectContaining({
      lease,
      workUnit,
      retryable: true,
      errorMessage: failure.message,
    }))
    expect(store.completePresalesWorkUnit).not.toHaveBeenCalled()
  })

  it('运行中心跳 fencing 失败时拒绝完成产物', async () => {
    vi.useFakeTimers()
    let resolveDiscovery!: (value: typeof discovery) => void
    discoverFullDocument.mockReturnValue(new Promise((resolve) => {
      resolveDiscovery = resolve
    }))
    const heartbeatError = new Error('执行租约已失效')
    store.heartbeatPresalesWorkUnit.mockRejectedValue(heartbeatError)

    const running = runPersistedFullDocumentDiscovery(input())
    await vi.waitFor(() => expect(discoverFullDocument).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(45_000)
    resolveDiscovery(discovery)

    await expect(running).rejects.toBe(heartbeatError)
    expect(store.completePresalesWorkUnit).not.toHaveBeenCalled()
    expect(store.failPresalesWorkUnit).toHaveBeenCalledWith(expect.objectContaining({
      retryable: true,
      errorMessage: heartbeatError.message,
    }))
  })
})
