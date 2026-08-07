<<<<<<< HEAD
import { createGateway } from 'ai'
=======
import { createDeepSeek } from '@ai-sdk/deepseek'
import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai'
import { defaultModelProfile } from './model-profile'
>>>>>>> internal

/**
 * AI Gateway 配置
 *
 * 使用 Vercel AI SDK Gateway 统一访问 AI 模型
 * 文档: https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway
 *
 * 环境变量配置:
<<<<<<< HEAD
 * - AI_GATEWAY_API_KEY: Gateway API 密钥 (必需)
 * - AI_GATEWAY_MODEL: 模型名称 (如: anthropic/claude-sonnet-4-20250514)
=======
 * - DEEPSEEK_API_KEY: DeepSeek API 密钥 (必需)
 * - DEEPSEEK_MODEL: 模型名称 (可选，默认: deepseek-v4-flash)
>>>>>>> internal
 */

// 创建 Gateway 实例
const gateway = createGateway({
  apiKey: process.env.AI_GATEWAY_API_KEY,
})

<<<<<<< HEAD
// 模型名称 - 从环境变量读取
const MODEL = process.env.AI_GATEWAY_MODEL || 'anthropic/claude-sonnet-4-20250514'

// 导出默认模型实例
export const defaultModel = gateway(MODEL)
=======
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
>>>>>>> internal
