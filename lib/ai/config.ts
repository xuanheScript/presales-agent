import { createDeepSeek } from '@ai-sdk/deepseek'

/**
 * DeepSeek AI 配置
 *
 * 使用 Vercel AI SDK DeepSeek Provider
 * 文档: https://ai-sdk.dev/providers/ai-sdk-providers/deepseek
 *
 * 环境变量配置:
 * - DEEPSEEK_API_KEY: DeepSeek API 密钥 (必需)
 * - DEEPSEEK_MODEL: 模型名称 (可选，默认: deepseek-chat)
 */

// 创建 DeepSeek 实例
const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? '',
})

// 模型名称 - 从环境变量读取
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

// 导出默认模型实例
export const defaultModel = deepseek(MODEL)
