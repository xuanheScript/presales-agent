import { describe, expect, it, vi } from 'vitest'
import {
  accumulateWorkflowUpdate,
  assertCompletedWorkflowResult,
  createCompleteEventAfterCommit,
  createPendingWorkflowResult,
  encodeSseEvent,
} from '../sse-protocol'
import type { WorkflowResult } from '../state'

function completedResult(): WorkflowResult {
  return {
    ...createPendingWorkflowResult(),
    success: true,
    analysis: {
      projectType: '管理系统',
      businessGoals: [],
      keyFeatures: [],
      techStack: [],
      nonFunctionalRequirements: {},
      risks: [],
    },
    estimation: {
      identifiedRoles: [],
      additionalWork: [],
      roleSummary: [],
      bufferCoefficient: 1,
      bufferReason: '无风险',
    },
    cost: {
      ruleVersion: 'formal-workflow-v1',
      servicePolicyVersion: 'formal-service-v1',
      currency: 'CNY',
      laborCostPerDay: 1_000,
      workingHoursPerDay: 8,
      baseDays: 0,
      bufferDays: 0,
      bufferedDays: 0,
      bufferCoefficient: 1,
      estimatedDurationDays: 0,
      staffingByRole: [],
      roleBreakdown: [],
      additionalWorkBreakdown: [],
      laborCost: 0,
      serviceCost: 0,
      infrastructureCost: 0,
      totalCost: 0,
      thirdPartyServices: [],
      reconciliation: {
        laborLinesTotal: 0,
        laborCostDifference: 0,
        isBalanced: true,
      },
    },
  }
}

describe('SSE protocol', () => {
  it('编码 UTF-8 SSE 事件', () => {
    const bytes = encodeSseEvent({
      event: 'progress',
      data: { step: '分析', count: 1 },
    })

    expect(new TextDecoder().decode(bytes)).toBe(
      'event: progress\ndata: {"step":"分析","count":1}\n\n'
    )
  })

  it('增量累积工作流状态并保留未更新字段', () => {
    const pending = createPendingWorkflowResult()
    const withAnalysis = accumulateWorkflowUpdate(pending, {
      analysis: completedResult().analysis,
      functions: [],
      isComplete: false,
    })
    const complete = accumulateWorkflowUpdate(withAnalysis, {
      estimation: completedResult().estimation,
      cost: completedResult().cost,
      isComplete: true,
      error: null,
    })

    expect(complete).toMatchObject({
      success: true,
      analysis: completedResult().analysis,
      error: null,
    })
  })

  it('错误状态不会成为成功结果', () => {
    const result = accumulateWorkflowUpdate(createPendingWorkflowResult(), {
      isComplete: true,
      error: '模型失败',
    })

    expect(result.success).toBe(false)
    expect(() => assertCompletedWorkflowResult(result)).toThrow('模型失败')
  })

  it('流结束但没有 complete 时 fail-close', () => {
    expect(() => assertCompletedWorkflowResult(createPendingWorkflowResult()))
      .toThrow('工作流未完整结束')
  })

  it('commit resolve 前不产生 complete 事件', async () => {
    let resolveCommit!: (estimateVersionId: string) => void
    const commit = vi.fn(() => new Promise<string>((resolve) => {
      resolveCommit = resolve
    }))
    let settled = false

    const eventPromise = createCompleteEventAfterCommit(
      'execution-1',
      completedResult(),
      commit
    ).then((event) => {
      settled = true
      return event
    })

    await Promise.resolve()
    expect(commit).toHaveBeenCalledOnce()
    expect(settled).toBe(false)

    resolveCommit('estimate-version-1')
    await expect(eventPromise).resolves.toMatchObject({
      event: 'complete',
      data: {
        executionId: 'execution-1',
        estimateVersionId: 'estimate-version-1',
        success: true,
      },
    })
  })

  it('commit reject 时绝不产生 complete', async () => {
    const failure = new Error('事务失败')
    const commit = vi.fn(async () => { throw failure })

    await expect(createCompleteEventAfterCommit(
      'execution-1',
      completedResult(),
      commit
    )).rejects.toBe(failure)
  })
})
