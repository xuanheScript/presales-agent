/**
 * 阿里 text-embedding-v4 嵌入向量服务
 *
 * 使用 DashScope OpenAI 兼容接口
 * 文档: https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api
 */

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

/**
 * 生成单条文本的 embedding 向量
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch(DASHSCOPE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `Embedding API 调用失败 (${response.status}): ${errorText}`
    )
  }

  const result: EmbeddingResponse = await response.json()
  return result.data[0].embedding
}

/**
 * 批量生成 embedding 向量（每次最多 10 条）
 */
export async function generateEmbeddings(
  texts: string[]
): Promise<number[][]> {
  if (texts.length === 0) return []
  if (texts.length > 10) {
    throw new Error('批量 embedding 每次最多 10 条')
  }

  const response = await fetch(DASHSCOPE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `Embedding API 批量调用失败 (${response.status}): ${errorText}`
    )
  }

  const result: EmbeddingResponse = await response.json()

  // 按 index 排序确保顺序一致
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
