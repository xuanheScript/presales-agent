import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateText } from 'ai'
import { discoverFunctions } from '../breakdown'
import {
  chunkRequirement,
  createFunctionDiscoveryEvidenceLines,
} from '../breakdown-function-discovery'
import type { PresalesState } from '../../state'

vi.mock('ai', () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn((options) => options),
    array: vi.fn((options) => options),
  },
}))

vi.mock('@/lib/observability/langfuse', () => ({
  createTelemetryConfig: vi.fn(() => undefined),
}))

const mockedGenerateText = vi.mocked(generateText)

function createState(): PresalesState {
  return {
    projectId: 'project-1',
    projectDescription: '制造数据平台',
    requirementId: 'requirement-1',
    requirementBaselineId: 'baseline-1',
    canonicalRequirement: [
      '4.1 数据集成',
      '系统需要从 ERP、MES 和 WMS 获取：',
      '销售订单',
      '物料和库存数据',
    ].join('\n'),
    rawRequirement: '系统需要从 ERP、MES 和 WMS 获取业务数据。',
  } as unknown as PresalesState
}

describe('Breakdown 功能发现证据锚定', () => {
  beforeEach(() => {
    mockedGenerateText.mockReset()
  })

  it('模型只选择证据 ID，由服务端确定性还原原文证据', async () => {
    const state = createState()
    const [source] = chunkRequirement(
      state.requirementBaselineId,
      state.canonicalRequirement
    )
    const evidenceLines = createFunctionDiscoveryEvidenceLines(source)
    const integrationEvidence = evidenceLines.find(
      ({ quote }) => quote === '系统需要从 ERP、MES 和 WMS 获取：'
    )
    expect(integrationEvidence).toBeDefined()

    mockedGenerateText.mockResolvedValueOnce({
      finishReason: 'stop',
      output: {
        sourceId: source.sourceId,
        coverageStatus: 'functions',
        functions: [{
          moduleName: '数据集成',
          functionName: '获取ERP、MES和WMS数据',
          description: '从三个业务系统获取数据',
          evidenceId: integrationEvidence!.evidenceId,
        }],
      },
    } as never)

    const functions = await discoverFunctions(
      [source],
      state,
      new AbortController().signal,
      { model: {} as never, maxRetries: 0 }
    )

    expect(functions).toHaveLength(1)
    expect(functions[0]).toMatchObject({
      moduleName: '数据集成',
      functionName: '获取ERP、MES和WMS数据',
    })
    expect(mockedGenerateText).toHaveBeenCalledTimes(1)
    const prompt = mockedGenerateText.mock.calls[0][0].prompt
    expect(prompt).toContain(`${integrationEvidence!.evidenceId} | ${integrationEvidence!.quote}`)
    expect(prompt).toContain('必须通过 evidenceId 选择')
  })

  it('模型引用不存在的证据 ID 时失败关闭', async () => {
    const state = createState()
    const [source] = chunkRequirement(
      state.requirementBaselineId,
      state.canonicalRequirement
    )

    mockedGenerateText.mockResolvedValueOnce({
      finishReason: 'stop',
      output: {
        sourceId: source.sourceId,
        coverageStatus: 'functions',
        functions: [{
          moduleName: '数据集成',
          functionName: '获取ERP、MES和WMS数据',
          description: '从三个业务系统获取数据',
          evidenceId: 'EVID-9999',
        }],
      },
    } as never)

    await expect(discoverFunctions(
      [source],
      state,
      new AbortController().signal,
      { model: {} as never, maxRetries: 0 }
    )).rejects.toThrow('引用了未知证据 ID')
  })
})
