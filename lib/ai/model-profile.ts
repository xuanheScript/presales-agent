import type { DeepSeekChatOptions } from '@ai-sdk/deepseek'
import type { JSONValue } from 'ai'

export type DeepSeekProviderOptions =
  Record<string, Record<string, JSONValue | undefined>> & {
    readonly deepseek: DeepSeekChatOptions
  }

const LEGACY_DEEPSEEK_MODELS = new Set([
  'deepseek-chat',
  'deepseek-reasoner',
])

export interface ModelProfile {
  readonly id: string
  readonly profileVersion: string
  readonly contextWindowTokens: number
  readonly maxOutputTokens: number
  readonly recommendedConcurrency: number
  readonly providerOptions: DeepSeekProviderOptions
}

export const DEFAULT_DEEPSEEK_MODEL_ID = 'deepseek-v4-flash'

export function createDeepSeekModelProfile(
  modelId = process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL_ID
): ModelProfile {
  const normalizedModelId = modelId.trim()
  if (!normalizedModelId) {
    throw new Error('DEEPSEEK_MODEL 不能为空')
  }
  if (LEGACY_DEEPSEEK_MODELS.has(normalizedModelId)) {
    throw new Error(
      `DEEPSEEK_MODEL=${normalizedModelId} 已停止服务，请改用 deepseek-v4-flash 或 deepseek-v4-pro`
    )
  }

  return {
    id: normalizedModelId,
    profileVersion: 'deepseek-v4-non-thinking-v1',
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 384_000,
    recommendedConcurrency: 3,
    providerOptions: {
      deepseek: {
        thinking: { type: 'disabled' },
      },
    },
  }
}

export const defaultModelProfile = createDeepSeekModelProfile()
