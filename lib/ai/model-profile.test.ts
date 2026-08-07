import { afterEach, describe, expect, it } from 'vitest'
import {
  createDeepSeekModelProfile,
  DEFAULT_DEEPSEEK_MODEL_ID,
} from './model-profile'

const originalModel = process.env.DEEPSEEK_MODEL

afterEach(() => {
  if (originalModel === undefined) delete process.env.DEEPSEEK_MODEL
  else process.env.DEEPSEEK_MODEL = originalModel
})

describe('createDeepSeekModelProfile', () => {
  it('使用固定的 V4 默认能力合同并关闭 thinking', () => {
    delete process.env.DEEPSEEK_MODEL

    expect(createDeepSeekModelProfile()).toEqual({
      id: DEFAULT_DEEPSEEK_MODEL_ID,
      profileVersion: 'deepseek-v4-non-thinking-v1',
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 384_000,
      recommendedConcurrency: 3,
      providerOptions: {
        deepseek: {
          thinking: { type: 'disabled' },
        },
      },
    })
  })

  it('规范化显式模型 ID', () => {
    expect(createDeepSeekModelProfile('  deepseek-v4-pro  ').id).toBe('deepseek-v4-pro')
  })

  it.each(['deepseek-chat', 'deepseek-reasoner'])(
    '拒绝已经停止服务的模型 %s',
    (modelId) => {
      expect(() => createDeepSeekModelProfile(modelId)).toThrow('已停止服务')
    }
  )

  it('拒绝空模型 ID', () => {
    expect(() => createDeepSeekModelProfile('   ')).toThrow('不能为空')
  })
})
