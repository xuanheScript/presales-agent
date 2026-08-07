import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { createModelGateway } from '@/lib/ai/model-gateway'
import type { PresalesState } from '../../state'
import {
  assertFullDocumentCapacity,
  createFullDocumentCapacityPlan,
  discoverFullDocument,
  fullDocumentDiscoveryOutputSchema,
  normalizeFullDocumentDiscovery,
} from '../full-document-discovery'

function state(requirement = '建设订单管理系统，支持订单创建、审批和查询。'): PresalesState {
  return {
    projectId: 'project-1',
    requirementBaselineId: 'baseline-1',
    canonicalRequirement: requirement,
    projectDescription: '制造业订单平台',
  } as PresalesState
}

const output = {
  analysis: {
    projectType: '订单管理系统',
    businessGoals: ['提升订单处理效率', '提升订单处理效率'],
    keyFeatures: ['订单创建', '订单审批'],
    techStack: ['Next.js'],
    nonFunctionalRequirements: { security: '需要权限控制' },
    risks: ['外部接口延期'],
  },
  functions: [
    {
      moduleName: '订单',
      functionName: '订单创建',
      description: '创建并保存订单',
      difficultyLevel: 'medium' as const,
      dependencies: [],
    },
    {
      moduleName: '订单',
      functionName: '订单创建',
      description: '创建、校验并保存订单',
      difficultyLevel: 'complex' as const,
      dependencies: ['客户主数据'],
    },
  ],
}

describe('full document discovery', () => {
  it('为系统提示、结构化输出和安全余量预留上下文', () => {
    const plan = createFullDocumentCapacityPlan('需求'.repeat(20_000), {
      id: 'test-model',
      profileVersion: 'test-v1',
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 384_000,
      recommendedConcurrency: 1,
      providerOptions: { deepseek: { thinking: { type: 'disabled' as const } } },
    })

    expect(plan).toMatchObject({
      reservedOutputTokens: 96_000,
      promptReserveTokens: 12_000,
      contextSafetyTokens: 50_000,
      availableInputTokens: 842_000,
      plannedModelCalls: 1,
      fitsContextWindow: true,
    })
  })

  it('超限时明确拒绝且不提供切片或截断回退', () => {
    const profile = {
      id: 'small-model',
      profileVersion: 'test-v1',
      contextWindowTokens: 20_000,
      maxOutputTokens: 4_000,
      recommendedConcurrency: 1,
      providerOptions: { deepseek: { thinking: { type: 'disabled' as const } } },
    }

    expect(() => assertFullDocumentCapacity('需求'.repeat(20_000), profile))
      .toThrow('不会截断、切片或自动降级')
  })

  it('Schema 不接受任何证据锚定字段', () => {
    expect(fullDocumentDiscoveryOutputSchema.safeParse(output).success).toBe(true)
    expect(fullDocumentDiscoveryOutputSchema.safeParse({
      ...output,
      functions: [{ ...output.functions[0], evidenceId: 'EVID-0001' }],
    }).success).toBe(false)
  })

  it('稳定去重功能并选择更完整描述和更高复杂度', () => {
    const normalized = normalizeFullDocumentDiscovery(output)

    expect(normalized.analysis.businessGoals).toEqual(['提升订单处理效率'])
    expect(normalized.functions).toEqual([expect.objectContaining({
      functionName: '订单创建',
      description: '创建、校验并保存订单',
      difficultyLevel: 'complex',
      dependencies: ['客户主数据'],
      roleEstimates: [],
    })])
  })

  it('普通 provider 失败也附带可持久化指标且不在 SDK 内重试全文', async () => {
    let calls = 0
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        calls += 1
        throw new Error('provider unavailable')
      },
    })

    const gateway = createModelGateway(model, 3)
    await expect(discoverFullDocument({
      state: state(),
      signal: new AbortController().signal,
      modelGateway: gateway,
    })).rejects.toMatchObject({
      message: 'provider unavailable',
      metrics: expect.objectContaining({
        configuredModelId: gateway.profile.id,
        finishReason: 'error',
        structuredOutputError: false,
      }),
    })
    expect(calls).toBe(1)
  })

  it('一次模型调用同时返回分析和完整功能列表', async () => {
    let calls = 0
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        calls += 1
        return {
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 50, text: 50, reasoning: 0 },
          },
          content: [{ type: 'text', text: JSON.stringify(output) }],
          warnings: [],
          response: { id: 'response-1' },
        }
      },
    })

    const result = await discoverFullDocument({
      state: state(),
      signal: new AbortController().signal,
      modelGateway: createModelGateway(model, 0),
    })

    expect(calls).toBe(1)
    expect(result.analysis.projectType).toBe('订单管理系统')
    expect(result.functions).toHaveLength(1)
    expect(result.metrics).toMatchObject({
      finishReason: 'stop',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    })
  })
})
