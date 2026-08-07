import { beforeEach, describe, expect, it, vi } from 'vitest'

const admin = vi.hoisted(() => ({
  from: vi.fn(),
}))

const findActiveTemplateWithClient = vi.hoisted(() => vi.fn())

const requestTemplate = vi.hoisted(() => vi.fn())

vi.mock('@/app/actions/templates', () => ({
  getActiveTemplate: requestTemplate,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => admin),
}))

vi.mock('@/lib/templates/active-template', () => ({
  findActiveTemplateWithClient,
}))

import { getAnalysisPromptSnapshotForWorker } from './analyze'

beforeEach(() => {
  requestTemplate.mockReset()
  requestTemplate.mockImplementation(() => {
    throw new Error('后台提示词读取不应调用页面 Server Action')
  })
  findActiveTemplateWithClient.mockReset()
})

describe('analysis prompt snapshot', () => {
  it('后台执行通过 admin 客户端固定数据库模板来源', async () => {
    findActiveTemplateWithClient.mockResolvedValue({
      id: 'template-1',
      template_name: '售前分析',
      prompt_content: '后台分析提示词',
      version: '2.1.0',
    })

    await expect(getAnalysisPromptSnapshotForWorker('政务')).resolves.toEqual({
      content: '后台分析提示词',
      version: 'template:template-1:2.1.0',
    })
    expect(findActiveTemplateWithClient).toHaveBeenCalledWith(
      admin,
      'requirement_analysis',
      '政务'
    )
    expect(requestTemplate).not.toHaveBeenCalled()
  })
})
