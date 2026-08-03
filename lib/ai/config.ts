import { createDeepSeek } from '@ai-sdk/deepseek'
import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai'
import { defaultModelProfile } from './model-profile'

/**
 * DeepSeek AI 配置
 *
 * 使用 Vercel AI SDK DeepSeek Provider
 * 文档: https://ai-sdk.dev/providers/ai-sdk-providers/deepseek
 *
 * 环境变量配置:
 * - DEEPSEEK_API_KEY: DeepSeek API 密钥 (必需)
 * - DEEPSEEK_MODEL: 模型名称 (可选，默认: deepseek-v4-flash)
 */

// 创建 DeepSeek 实例
const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? '',
})

// 模型名称及能力由单一 profile 固定，避免执行来源与实际调用漂移。
const rawDefaultModel = deepseek(defaultModelProfile.id)

// extraction/workflow 均禁止 provider 默认开启 thinking；调用点无法覆盖这一约束。
const forceDeepSeekNonThinking: LanguageModelMiddleware = {
  specificationVersion: 'v3',
  transformParams: async ({ params }) => ({
    ...params,
    providerOptions: {
      ...params.providerOptions,
      deepseek: {
        ...params.providerOptions?.deepseek,
        thinking: { type: 'disabled' },
      },
    },
  }),
}

export const defaultModel = wrapLanguageModel({
  model: rawDefaultModel,
  middleware: forceDeepSeekNonThinking,
})
