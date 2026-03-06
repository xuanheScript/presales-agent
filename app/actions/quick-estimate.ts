'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { QuickEstimate, QuickEstimateItem } from '@/types'

/**
 * 保存快速估算
 */
export async function saveQuickEstimate(data: {
  name: string
  description?: string
  selected_items: QuickEstimateItem[]
  total_hours: number
  total_adjusted_hours: number
  buffer_coefficient: number
  labor_cost_per_day: number
  total_cost: number
}): Promise<{ success: boolean; error?: string; id?: string }> {
  const supabase = await createClient()

  const { data: user } = await supabase.auth.getUser()
  if (!user.user) {
    return { success: false, error: '未登录' }
  }

  if (!data.name.trim()) {
    return { success: false, error: '请输入估算名称' }
  }

  if (data.selected_items.length === 0) {
    return { success: false, error: '请至少选择一个功能' }
  }

  const { data: result, error } = await supabase
    .from('quick_estimates')
    .insert({
      name: data.name.trim(),
      description: data.description?.trim() || null,
      selected_items: data.selected_items,
      total_hours: data.total_hours,
      total_adjusted_hours: data.total_adjusted_hours,
      buffer_coefficient: data.buffer_coefficient,
      labor_cost_per_day: data.labor_cost_per_day,
      total_cost: data.total_cost,
      created_by: user.user.id,
    })
    .select('id')
    .single()

  if (error) {
    console.error('保存快速估算失败:', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/quick-estimate')
  return { success: true, id: result.id }
}

/**
 * 获取当前用户的快速估算列表
 */
export async function getQuickEstimates(): Promise<QuickEstimate[]> {
  const supabase = await createClient()

  const { data: user } = await supabase.auth.getUser()
  if (!user.user) {
    return []
  }

  const { data, error } = await supabase
    .from('quick_estimates')
    .select('*')
    .eq('created_by', user.user.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('获取快速估算列表失败:', error)
    return []
  }

  return data || []
}

/**
 * 获取单条快速估算
 */
export async function getQuickEstimate(id: string): Promise<QuickEstimate | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('quick_estimates')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('获取快速估算失败:', error)
    return null
  }

  return data
}

/**
 * 删除快速估算
 */
export async function deleteQuickEstimate(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('quick_estimates')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('删除快速估算失败:', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/quick-estimate')
  return { success: true }
}
