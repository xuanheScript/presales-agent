import { defaultModelGateway, type ModelGateway } from '@/lib/ai/model-gateway'
import { createManagedAbortSignal, throwIfAborted } from './execution-policy'
import type { PresalesState } from './state'
import {
  discoverFullDocument,
  type FullDocumentDiscoveryResult,
  type ModelCallFailure,
} from './nodes/full-document-discovery'
import {
  claimPresalesExecution,
  claimPresalesWorkUnit,
  completePresalesWorkUnit,
  failPresalesWorkUnit,
  heartbeatPresalesExecution,
  heartbeatPresalesWorkUnit,
  loadSucceededFullDocumentDiscovery,
  recordPresalesModelCall,
  type ClaimedPresalesWorkUnit,
  type PresalesExecutionLease,
} from './work-unit-store'
import type { RunnableConfig } from '@langchain/core/runnables'

const EXECUTION_LEASE_SECONDS = 900
const WORK_UNIT_LEASE_SECONDS = 900
const HEARTBEAT_INTERVAL_MS = 45_000

export interface PersistedFullDocumentDiscoveryInput {
  actorUserId: string
  executionId: string
  workerId: string
  projectId: string
  state: PresalesState
  signal?: AbortSignal
  modelGateway?: ModelGateway
  config?: RunnableConfig
  onLeaseClaimed?: (lease: PresalesExecutionLease) => void
}

function modelCallMetrics(error: unknown): ModelCallFailure['metrics'] | null {
  if (!(error instanceof Error) || !('metrics' in error)) return null
  const metrics = (error as Partial<ModelCallFailure>).metrics
  return metrics && typeof metrics === 'object' ? metrics : null
}

function isRetryableDiscoveryError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return false
  if (!(error instanceof Error)) return true
  return !/超过全文分析可用输入容量|不会截断|未发现可估算功能/u.test(error.message)
}

async function runHeartbeat(input: {
  lease: PresalesExecutionLease
  workUnit: ClaimedPresalesWorkUnit
  signal: AbortSignal
}): Promise<() => Promise<void>> {
  let stopped = false
  let active: Promise<void> | null = null
  let heartbeatError: unknown = null
  const heartbeat = async () => {
    if (stopped || input.signal.aborted || active) return
    active = Promise.all([
      heartbeatPresalesExecution({
        lease: input.lease,
        stage: 'discovering',
        progressPercent: 15,
        leaseSeconds: EXECUTION_LEASE_SECONDS,
      }),
      heartbeatPresalesWorkUnit({
        lease: input.lease,
        workUnit: input.workUnit,
        leaseSeconds: WORK_UNIT_LEASE_SECONDS,
      }),
    ]).then(() => undefined).catch((error) => {
      heartbeatError = error
    }).finally(() => {
      active = null
    })
    await active
  }
  const timer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS)
  return async () => {
    stopped = true
    clearInterval(timer)
    if (active) await active
    if (heartbeatError) throw heartbeatError
  }
}

export async function runPersistedFullDocumentDiscovery(
  input: PersistedFullDocumentDiscoveryInput
): Promise<FullDocumentDiscoveryResult> {
  const gateway = input.modelGateway ?? defaultModelGateway
  const managed = createManagedAbortSignal([input.signal])
  const signal = managed.signal

  try {
    throwIfAborted(signal)
    const lease = await claimPresalesExecution({
      actorUserId: input.actorUserId,
      executionId: input.executionId,
      workerId: input.workerId,
      leaseSeconds: EXECUTION_LEASE_SECONDS,
    })
    input.onLeaseClaimed?.(lease)

    const existing = await loadSucceededFullDocumentDiscovery(input.executionId)
    if (existing) {
      await heartbeatPresalesExecution({
        lease,
        stage: 'enriching',
        progressPercent: 55,
        leaseSeconds: EXECUTION_LEASE_SECONDS,
      })
      return existing
    }

    await heartbeatPresalesExecution({
      lease,
      stage: 'discovering',
      progressPercent: 10,
      leaseSeconds: EXECUTION_LEASE_SECONDS,
    })
    const workUnit = await claimPresalesWorkUnit({
      lease,
      stage: 'full_document_discovery',
      leaseSeconds: WORK_UNIT_LEASE_SECONDS,
    })
    if (!workUnit) {
      const raced = await loadSucceededFullDocumentDiscovery(input.executionId)
      if (raced) return raced
      throw new Error('全文需求分析工作单元当前不可领取')
    }

    const stopHeartbeat = await runHeartbeat({ lease, workUnit, signal })
    let heartbeatStopped = false
    const stop = async () => {
      if (heartbeatStopped) return
      heartbeatStopped = true
      await stopHeartbeat()
    }

    try {
      const result = await discoverFullDocument({
        state: input.state,
        signal,
        modelGateway: gateway,
        config: input.config,
      })
      await stop()
      await recordPresalesModelCall({
        lease,
        workUnit,
        projectId: input.projectId,
        callKey: `full-document-discovery:global:attempt:${workUnit.attempt}`,
        stage: 'full_document_discovery',
        attempt: workUnit.attempt,
        profileVersion: gateway.profile.profileVersion,
        providerOptions: gateway.profile.providerOptions,
        metrics: result.metrics,
      })
      await completePresalesWorkUnit({
        lease,
        workUnit,
        output: {
          analysis: result.analysis,
          functions: result.functions,
        },
        metrics: result.metrics,
      })
      await heartbeatPresalesExecution({
        lease,
        stage: 'enriching',
        progressPercent: 55,
        leaseSeconds: EXECUTION_LEASE_SECONDS,
      })
      return result
    } catch (error) {
      await stop()
      const metrics = modelCallMetrics(error)
      if (metrics) {
        await recordPresalesModelCall({
          lease,
          workUnit,
          projectId: input.projectId,
          callKey: `full-document-discovery:global:attempt:${workUnit.attempt}`,
          stage: 'full_document_discovery',
          attempt: workUnit.attempt,
          profileVersion: gateway.profile.profileVersion,
          providerOptions: gateway.profile.providerOptions,
          metrics,
        })
      }
      const status = await failPresalesWorkUnit({
        lease,
        workUnit,
        errorCode: error instanceof Error ? error.name || 'DISCOVERY_ERROR' : 'DISCOVERY_ERROR',
        errorMessage: error instanceof Error ? error.message : '全文需求分析失败',
        retryable: isRetryableDiscoveryError(error, signal),
        retryDelaySeconds: 10,
      })
      if (status === 'retry_wait') {
        throw new Error('全文需求分析暂时失败，将由后台任务重试', { cause: error })
      }
      throw error
    }
  } finally {
    managed.dispose()
  }
}
