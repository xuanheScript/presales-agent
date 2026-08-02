import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EmbeddingApiError,
  buildEmbeddingText,
  generateEmbedding,
  generateEmbeddings,
} from '../embedding'

function embeddingResponse(items: Array<{ index: number; embedding: number[] }>): Response {
  return new Response(JSON.stringify({
    data: items.map((item) => ({ ...item, object: 'embedding' })),
    model: 'text-embedding-v4',
    usage: { prompt_tokens: 1, total_tokens: 1 },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function httpError(status: number): Response {
  return new Response(`error-${status}`, { status })
}

describe('Embedding transport', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('成功返回单条向量', async () => {
    vi.stubEnv('DASHSCOPE_API_KEY', 'test-key')
    const fetch = vi.fn(async () => embeddingResponse([
      { index: 0, embedding: [0.1, 0.2] },
    ]))

    await expect(generateEmbedding('文本', { fetch, maxRetries: 0 }))
      .resolves.toEqual([0.1, 0.2])
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([408, 429, 500, 529])('%i 后有限重试并成功', async (status) => {
    vi.stubEnv('DASHSCOPE_API_KEY', 'test-key')
    const fetch = vi.fn()
      .mockResolvedValueOnce(httpError(status))
      .mockResolvedValueOnce(embeddingResponse([{ index: 0, embedding: [1] }]))
    const sleep = vi.fn(async () => {})

    await expect(generateEmbedding('文本', { fetch, sleep, maxRetries: 1 }))
      .resolves.toEqual([1])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(250, expect.any(AbortSignal))
  })

  it.each([400, 401, 403, 404])('%i 不重试', async (status) => {
    vi.stubEnv('DASHSCOPE_API_KEY', 'test-key')
    const fetch = vi.fn(async () => httpError(status))
    const sleep = vi.fn(async () => {})

    await expect(generateEmbedding('文本', { fetch, sleep, maxRetries: 2 }))
      .rejects.toMatchObject({ name: 'EmbeddingApiError', status })
    expect(fetch).toHaveBeenCalledOnce()
    expect(sleep).not.toHaveBeenCalled()
  })

  it('网络 TypeError 可重试且达到上限后抛出', async () => {
    vi.stubEnv('DASHSCOPE_API_KEY', 'test-key')
    const failure = new TypeError('network unavailable')
    const fetch = vi.fn(async () => { throw failure })
    const sleep = vi.fn(async () => {})

    await expect(generateEmbedding('文本', { fetch, sleep, maxRetries: 1 }))
      .rejects.toBe(failure)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledOnce()
  })

  it('Abort 不重试', async () => {
    vi.stubEnv('DASHSCOPE_API_KEY', 'test-key')
    const controller = new AbortController()
    const reason = new DOMException('用户取消', 'AbortError')
    const fetch = vi.fn(async () => {
      controller.abort(reason)
      throw reason
    })
    const sleep = vi.fn(async () => {})

    await expect(generateEmbedding('文本', {
      signal: controller.signal,
      fetch,
      sleep,
      maxRetries: 2,
    })).rejects.toBe(reason)
    expect(fetch).toHaveBeenCalledOnce()
    expect(sleep).not.toHaveBeenCalled()
  })

  it('退避期间 Abort 会停止后续请求', async () => {
    vi.stubEnv('DASHSCOPE_API_KEY', 'test-key')
    const controller = new AbortController()
    const reason = new DOMException('停止退避', 'AbortError')
    const fetch = vi.fn(async () => httpError(429))
    const sleep = vi.fn(async (_ms: number, signal: AbortSignal) => {
      controller.abort(reason)
      throw signal.reason
    })

    await expect(generateEmbedding('文本', {
      signal: controller.signal,
      fetch,
      sleep,
      maxRetries: 2,
    })).rejects.toBe(reason)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('总 deadline 到期时以 TimeoutError 结束', async () => {
    vi.useFakeTimers()
    vi.stubEnv('DASHSCOPE_API_KEY', 'test-key')
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    ))

    const running = generateEmbedding('文本', {
      fetch: fetch as typeof globalThis.fetch,
      timeoutMs: 100,
      maxRetries: 0,
    })
    const rejection = expect(running).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(100)

    await rejection
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('批量结果按 index 排序', async () => {
    vi.stubEnv('DASHSCOPE_API_KEY', 'test-key')
    const fetch = vi.fn(async () => embeddingResponse([
      { index: 1, embedding: [2] },
      { index: 0, embedding: [1] },
    ]))

    await expect(generateEmbeddings(['a', 'b'], { fetch, maxRetries: 0 }))
      .resolves.toEqual([[1], [2]])
  })

  it('空批次不请求，超过十条拒绝', async () => {
    const fetch = vi.fn()

    await expect(generateEmbeddings([], { fetch })).resolves.toEqual([])
    await expect(generateEmbeddings(Array.from({ length: 11 }, () => 'x'), { fetch }))
      .rejects.toThrow('批量 embedding 每次最多 10 条')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('错误保留 HTTP 状态', () => {
    const error = new EmbeddingApiError('rate limited', 429)
    expect(error).toMatchObject({ name: 'EmbeddingApiError', status: 429 })
  })
})

describe('buildEmbeddingText', () => {
  it('忽略空描述并拼接字段', () => {
    expect(buildEmbeddingText({
      module_name: '订单',
      function_name: '查询',
      description: null,
    })).toBe('订单 查询')
  })
})
