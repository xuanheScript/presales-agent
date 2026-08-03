import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EstimateReference } from '@/types'

const createAdminClient = vi.hoisted(() => vi.fn())
const generateEmbedding = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/ai/embedding', () => ({ generateEmbedding }))

import {
  getReferencesForBreakdownInWorker,
  incrementReferenceUsageInWorker,
} from './estimate-reference-service'

const reference: EstimateReference = {
  id: 'reference-1',
  module_name: '订单',
  function_name: '订单创建',
  description: '创建订单',
  difficulty_level: 'medium',
  role_estimates: [{ role: '后端开发', days: 2 }],
  estimated_hours: 16,
  project_type: '管理系统',
  category: null,
  industry: null,
  tech_stack: null,
  source_project_id: null,
  source_function_module_id: null,
  usage_count: 3,
  verified_by: null,
  created_at: '2026-08-03T00:00:00.000Z',
  updated_at: '2026-08-03T00:00:00.000Z',
}

function abortableResult<T>(result: T) {
  return {
    abortSignal: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
}

beforeEach(() => {
  createAdminClient.mockReset()
  generateEmbedding.mockReset()
})

describe('estimate reference worker service', () => {
  it('向量检索命中时使用 admin client 且不查询 fallback', async () => {
    const vectorQuery = abortableResult({ data: [{ ...reference, similarity: 0.91 }], error: null })
    const rpc = vi.fn().mockReturnValue(vectorQuery)
    const from = vi.fn()
    createAdminClient.mockReturnValue({ rpc, from })
    generateEmbedding.mockResolvedValue([0.1, 0.2])
    const controller = new AbortController()

    await expect(getReferencesForBreakdownInWorker('订单系统', 10, {
      signal: controller.signal,
    })).resolves.toEqual([{ ...reference, similarity: 0.91 }])

    expect(generateEmbedding).toHaveBeenCalledWith('订单系统', {
      signal: controller.signal,
    })
    expect(rpc).toHaveBeenCalledWith('match_estimate_references', {
      query_embedding: '[0.1,0.2]',
      match_threshold: 0.3,
      match_count: 10,
    })
    expect(vectorQuery.abortSignal).toHaveBeenCalledWith(controller.signal)
    expect(from).not.toHaveBeenCalled()
  })

  it('embedding 失败后使用显式列 fallback 并限制最大返回数', async () => {
    const fallbackResult = { data: [reference], error: null }
    const fallbackQuery = abortableResult(fallbackResult)
    const limit = vi.fn().mockReturnValue(fallbackQuery)
    const order = vi.fn().mockReturnValue({ limit })
    const select = vi.fn().mockReturnValue({ order })
    const from = vi.fn().mockReturnValue({ select })
    createAdminClient.mockReturnValue({ rpc: vi.fn(), from })
    generateEmbedding.mockRejectedValue(new Error('embedding unavailable'))
    const controller = new AbortController()

    await expect(getReferencesForBreakdownInWorker('订单系统', 99, {
      signal: controller.signal,
    })).resolves.toEqual([reference])

    expect(from).toHaveBeenCalledWith('estimate_references')
    expect(select).toHaveBeenCalledWith(expect.not.stringContaining('*'))
    expect(order).toHaveBeenCalledWith('usage_count', { ascending: false })
    expect(limit).toHaveBeenCalledWith(20)
    expect(fallbackQuery.abortSignal).toHaveBeenCalledWith(controller.signal)
  })

  it('取消错误会直接透传而不执行 fallback', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('cancelled', 'AbortError')
    controller.abort(abortError)
    const from = vi.fn()
    createAdminClient.mockReturnValue({ rpc: vi.fn(), from })
    generateEmbedding.mockRejectedValue(abortError)

    await expect(getReferencesForBreakdownInWorker('订单系统', 10, {
      signal: controller.signal,
    })).rejects.toBe(abortError)
    expect(from).not.toHaveBeenCalled()
  })

  it('fallback 查询失败时返回空数组', async () => {
    const limit = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'database unavailable' },
    })
    const order = vi.fn().mockReturnValue({ limit })
    const select = vi.fn().mockReturnValue({ order })
    createAdminClient.mockReturnValue({
      rpc: vi.fn(),
      from: vi.fn().mockReturnValue({ select }),
    })
    generateEmbedding.mockRejectedValue(new Error('embedding unavailable'))

    await expect(getReferencesForBreakdownInWorker('订单系统')).resolves.toEqual([])
  })

  it('空 ID 不创建 client，重复 ID 只递增一次', async () => {
    await incrementReferenceUsageInWorker([])
    expect(createAdminClient).not.toHaveBeenCalled()

    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    createAdminClient.mockReturnValue({ rpc })
    await incrementReferenceUsageInWorker(['reference-1', 'reference-1', 'reference-2'])

    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenCalledWith('increment_estimate_reference_usage', {
      reference_id: 'reference-1',
    })
    expect(rpc).toHaveBeenCalledWith('increment_estimate_reference_usage', {
      reference_id: 'reference-2',
    })
  })
})
