import { describe, expect, it, vi } from 'vitest'
import { findActiveTemplateWithClient } from './active-template'

function queryResult(data: unknown) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error: null })
  const limit = vi.fn().mockReturnValue({ maybeSingle })
  const order = vi.fn().mockReturnValue({ limit })
  const eq = vi.fn().mockReturnThis()
  return { query: { eq, order }, eq, order, limit, maybeSingle }
}

describe('active template query', () => {
  it('行业模板缺失时复用同一客户端查询通用模板', async () => {
    const industryQuery = queryResult(null)
    const fallbackTemplate = {
      id: 'template-1',
      template_type: 'requirement_analysis',
      template_name: '通用分析',
      prompt_content: '分析需求',
      industry: null,
      version: '1.0.0',
      is_active: true,
      created_at: '2026-08-03T00:00:00Z',
      updated_at: '2026-08-03T00:00:00Z',
    }
    const fallbackQuery = queryResult(fallbackTemplate)
    const client = {
      from: vi.fn()
        .mockReturnValueOnce({ select: vi.fn(() => industryQuery.query) })
        .mockReturnValueOnce({ select: vi.fn(() => fallbackQuery.query) }),
    }

    await expect(findActiveTemplateWithClient(
      client as never,
      'requirement_analysis',
      '政务'
    )).resolves.toEqual(fallbackTemplate)

    expect(client.from).toHaveBeenCalledTimes(2)
    expect(industryQuery.eq).toHaveBeenCalledWith('template_type', 'requirement_analysis')
    expect(industryQuery.eq).toHaveBeenCalledWith('is_active', true)
    expect(industryQuery.eq).toHaveBeenCalledWith('industry', '政务')
    expect(fallbackQuery.eq).toHaveBeenCalledWith('template_type', 'requirement_analysis')
    expect(fallbackQuery.eq).toHaveBeenCalledWith('is_active', true)
    expect(fallbackQuery.eq).not.toHaveBeenCalledWith('industry', expect.anything())
  })
})
