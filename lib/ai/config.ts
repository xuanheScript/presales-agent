import { createGateway } from 'ai'

/**
 * AI Gateway 配置
 *
 * 使用 Vercel AI SDK Gateway 统一访问 AI 模型
 * 文档: https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway
 *
 * 环境变量配置:
 * - AI_GATEWAY_API_KEY: Gateway API 密钥 (必需)
 * - AI_GATEWAY_MODEL: 模型名称 (如: anthropic/claude-sonnet-4-20250514)
 */

// 创建 Gateway 实例
const gateway = createGateway({
  apiKey: process.env.AI_GATEWAY_API_KEY,
})

// 模型名称 - 从环境变量读取
const MODEL = process.env.AI_GATEWAY_MODEL || 'anthropic/claude-sonnet-4-20250514'

// 导出默认模型实例
export const defaultModel = gateway(MODEL)
