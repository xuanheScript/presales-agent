'use server'

import { createClient } from '@/lib/supabase/server'
import type { CostEstimate } from '@/types'

/**
 * 获取项目的成本估算
 */
export async function getCostEstimate(projectId: string): Promise<CostEstimate | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  // 验证项目属于当前用户
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('created_by', user.id)
    .single()

  if (!project) {
    return null
  }

  const { data, error } = await supabase
    .from('cost_estimates')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error) {
    // 可能是没有成本估算记录
    return null
  }

  return data
}
