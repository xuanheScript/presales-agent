import {
  EXECUTION_POLICY,
  isAbortError,
  throwIfAborted,
  withAbortSignal,
} from '@/lib/agents/execution-policy'

const DASHSCOPE_API_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings'
const EMBEDDING_MODEL = 'text-embedding-v4'
const EMBEDDING_DIMENSIONS = 1024

function getApiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY
  if (!key) {
    throw new Error('DASHSCOPE_API_KEY 环境变量未配置')
  }
  return key
}

interface EmbeddingResponse {
  data: Array<{
    embedding: number[]
    index: number
    object: string
  }>
  model: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}

export interface EmbeddingRequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
  maxRetries?: number
  traceMetadata?: Record<string, string | number | boolean | string[]>
  fetch?: typeof globalThis.fetch
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

export class EmbeddingApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'EmbeddingApiError'
  }
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof EmbeddingApiError) {
    return error.status === 408 || error.status === 429 || error.status >= 500
  }

  return error instanceof TypeError
}

function retryDelay(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 1_000)
}

async function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }

    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timeout)
      cleanup()
      reject(signal.reason)
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function requestEmbeddings(
  input: string | string[],
  options: EmbeddingRequestOptions
): Promise<EmbeddingResponse> {
  return withAbortSignal(
    [options.signal],
    options.timeoutMs ?? EXECUTION_POLICY.embeddingTimeoutMs,
    async (signal) => {
      const maxRetries = options.maxRetries ?? EXECUTION_POLICY.embeddingMaxRetries

      for (let attempt = 0; ; attempt += 1) {
        throwIfAborted(signal)

        try {
          const request = options.fetch ?? globalThis.fetch
          const response = await request(DASHSCOPE_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${getApiKey()}`,
            },
            body: JSON.stringify({
              model: EMBEDDING_MODEL,
              input,
              dimensions: EMBEDDING_DIMENSIONS,
            }),
            signal,
          })

          if (!response.ok) {
            const errorText = await response.text()
            throw new EmbeddingApiError(
              `Embedding API 调用失败 (${response.status}): ${errorText}`,
              response.status
            )
          }

          return await response.json() as EmbeddingResponse
        } catch (error) {
          if (isAbortError(error, signal) || attempt >= maxRetries || !isRetryableError(error)) {
            throw error
          }

          await (options.sleep ?? waitForRetry)(retryDelay(attempt), signal)
        }
      }
    }
  )
}

/**
 * 生成单条文本的 embedding 向量
 */
export async function generateEmbedding(
  text: string,
  options: EmbeddingRequestOptions = {}
): Promise<number[]> {
  const result = await requestEmbeddings(text, options)
  return result.data[0].embedding
}

/**
 * 批量生成 embedding 向量（每次最多 10 条）
 */
export async function generateEmbeddings(
  texts: string[],
  options: EmbeddingRequestOptions = {}
): Promise<number[][]> {
  if (texts.length === 0) return []
  if (texts.length > 10) {
    throw new Error('批量 embedding 每次最多 10 条')
  }

  const result = await requestEmbeddings(texts, options)

  return result.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding)
}

/**
 * 将参考数据拼接为 embedding 输入文本
 */
export function buildEmbeddingText(ref: {
  module_name: string
  function_name: string
  description?: string | null
}): string {
  return [ref.module_name, ref.function_name, ref.description || '']
    .filter(Boolean)
    .join(' ')
}
