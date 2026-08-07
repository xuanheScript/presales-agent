import { beforeEach, describe, expect, it, vi } from 'vitest'

const serverClient = vi.hoisted(() => ({
  from: vi.fn(),
}))

const findActiveTemplateWithClient = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => serverClient),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => {
    throw new Error('页面模板操作不应使用后台客户端')
  }),
}))

vi.mock('@/lib/templates/active-template', () => ({
  findActiveTemplateWithClient,
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { getActiveTemplate } from './templates'
import { createClient } from '@/lib/supabase/server'

beforeEach(() => {
  findActiveTemplateWithClient.mockResolvedValue(null)
})

describe('template actions', () => {
  it('活跃模板读取继续使用请求客户端并委托共享查询', async () => {
    await getActiveTemplate('requirement_analysis', '政务')

    expect(createClient).toHaveBeenCalledOnce()
    expect(findActiveTemplateWithClient).toHaveBeenCalledWith(
      serverClient,
      'requirement_analysis',
      '政务'
    )
  })
})
