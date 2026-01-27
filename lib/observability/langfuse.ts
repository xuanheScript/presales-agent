/**
 * Langfuse 观测性配置
 *
 * 提供 AI SDK 和 LangGraph 的统一监控能力
 * 文档: https://langfuse.com/integrations/frameworks/vercel-ai-sdk
 */

import { LangfuseSpanProcessor, type ShouldExportSpan } from '@langfuse/otel'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

// 是否已初始化
let isInitialized = false

// SpanProcessor 实例（用于 flush）
let spanProcessor: LangfuseSpanProcessor | null = null

/**
 * 检查 Langfuse 是否已配置
 */
export function isLangfuseEnabled(): boolean {
  return !!(process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_PUBLIC_KEY)
}

/**
 * 初始化 Langfuse OpenTelemetry
 *
 * 在 Next.js 中，这个函数应该在 instrumentation.ts 中调用
 */
export function initLangfuse(): LangfuseSpanProcessor | null {
  if (isInitialized) {
    return spanProcessor
  }

  if (!isLangfuseEnabled()) {
    console.log('[Langfuse] 未配置 API 密钥，跳过初始化')
    return null
  }

  try {
    // 过滤掉 Next.js 内部的 spans
    const shouldExportSpan: ShouldExportSpan = (span) => {
      return span.otelSpan.instrumentationScope.name !== 'next.js'
    }

    spanProcessor = new LangfuseSpanProcessor({
      shouldExportSpan,
    })

    const tracerProvider = new NodeTracerProvider({
      spanProcessors: [spanProcessor],
    })

    tracerProvider.register()
    isInitialized = true

    console.log('[Langfuse] 初始化成功')
    return spanProcessor
  } catch (error) {
    console.error('[Langfuse] 初始化失败:', error)
    return null
  }
}

/**
 * 获取 SpanProcessor 实例
 */
export function getSpanProcessor(): LangfuseSpanProcessor | null {
  return spanProcessor
}

/**
 * 创建 AI SDK telemetry 配置
 *
 * @param functionId - 功能标识（如 'elicitation', 'chat'）
 * @param metadata - 额外的元数据
 */
export function createTelemetryConfig(
  functionId: string,
  metadata?: Record<string, string | number | boolean | string[]>
) {
  if (!isLangfuseEnabled()) {
    return { isEnabled: false }
  }

  return {
    isEnabled: true,
    functionId,
    metadata: {
      ...metadata,
      environment: process.env.NODE_ENV || 'development',
    },
  }
}

/**
 * 创建带 trace ID 的 telemetry 配置（用于关联多个调用）
 *
 * @param functionId - 功能标识
 * @param traceId - Langfuse trace ID
 * @param metadata - 额外的元数据
 */
export function createTelemetryConfigWithTrace(
  functionId: string,
  traceId: string,
  metadata?: Record<string, string | number | boolean | string[]>
) {
  if (!isLangfuseEnabled()) {
    return { isEnabled: false }
  }

  return {
    isEnabled: true,
    functionId,
    metadata: {
      ...metadata,
      langfuseTraceId: traceId,
      environment: process.env.NODE_ENV || 'development',
    },
  }
}

/**
 * 强制刷新所有待发送的 traces
 *
 * 在 serverless 环境中，确保在响应结束前调用
 */
export async function flushLangfuse(): Promise<void> {
  if (spanProcessor) {
    await spanProcessor.forceFlush()
  }
}

/**
 * 关闭 Langfuse
 */
export async function shutdownLangfuse(): Promise<void> {
  if (spanProcessor) {
    await spanProcessor.shutdown()
    spanProcessor = null
    isInitialized = false
  }
}
