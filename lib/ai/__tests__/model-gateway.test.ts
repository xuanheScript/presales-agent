import { APICallError, Output, generateText, type LanguageModel } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { createModelGateway } from '../model-gateway'

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 20,
    text: 20,
    reasoning: 0,
  },
}

function response(text: string, finishReason: 'stop' | 'length' = 'stop') {
  return {
    finishReason: { unified: finishReason, raw: finishReason },
    usage,
    content: [{ type: 'text' as const, text }],
    warnings: [],
  }
}

async function generateWithGateway(model: LanguageModel, maxRetries: number) {
  const gateway = createModelGateway(model, maxRetries)
  return generateText({
    model: gateway.model,
    maxRetries: gateway.maxRetries,
    output: Output.object({
      schema: z.object({ value: z.string() }),
    }),
    prompt: 'test',
  })
}

describe('ModelGateway', () => {
  it('使用可控模型返回结构化成功结果', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: response('{"value":"ok"}'),
    })

    const result = await generateWithGateway(model, 0)

    expect(result.output).toEqual({ value: 'ok' })
    expect(model.doGenerateCalls).toHaveLength(1)
  })

  it('保留截断 finishReason 供业务 fail-close', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: response('{"value":"partial"}', 'length'),
    })

    const result = await generateWithGateway(model, 0)

    expect(result.finishReason).toBe('length')
    expect(() => result.output).toThrowError(
      expect.objectContaining({ name: 'AI_NoOutputGeneratedError' })
    )
  })

  it('非法结构化输出在读取 output 时抛出确定性错误且不重试', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: response('{"wrong":true}'),
    })

    await expect(generateWithGateway(model, 0)).rejects.toMatchObject({
      name: 'AI_NoObjectGeneratedError',
    })
    expect(model.doGenerateCalls).toHaveLength(1)
  })

  it.each([429, 500, 529])('%i 瞬态错误按网关上限有限重试', async (statusCode) => {
    let calls = 0
    const error = new APICallError({
      message: `HTTP ${statusCode}`,
      url: 'https://model.test',
      requestBodyValues: {},
      statusCode,
      isRetryable: true,
    })
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        calls += 1
        if (calls === 1) throw error
        return response('{"value":"recovered"}')
      },
    })

    const result = await generateWithGateway(model, 1)

    expect(result.output).toEqual({ value: 'recovered' })
    expect(calls).toBe(2)
  })

  it('不可重试错误只调用一次', async () => {
    const error = new APICallError({
      message: 'HTTP 400',
      url: 'https://model.test',
      requestBodyValues: {},
      statusCode: 400,
      isRetryable: false,
    })
    const model = new MockLanguageModelV3({
      doGenerate: async () => { throw error },
    })

    await expect(generateWithGateway(model, 1)).rejects.toBe(error)
    expect(model.doGenerateCalls).toHaveLength(1)
  })

  it('Abort 不重试', async () => {
    const reason = new DOMException('用户取消', 'AbortError')
    const model = new MockLanguageModelV3({
      doGenerate: async () => { throw reason },
    })

    await expect(generateWithGateway(model, 1)).rejects.toBe(reason)
    expect(model.doGenerateCalls).toHaveLength(1)
  })

  it('Timeout 不重试', async () => {
    const reason = new DOMException('执行超时', 'TimeoutError')
    const model = new MockLanguageModelV3({
      doGenerate: async () => { throw reason },
    })

    await expect(generateWithGateway(model, 1)).rejects.toBe(reason)
    expect(model.doGenerateCalls).toHaveLength(1)
  })
})
