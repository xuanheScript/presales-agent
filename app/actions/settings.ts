'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { DEFAULT_CONFIG } from '@/constants'
import type { SystemConfig } from '@/types'

/**
 * 获取系统配置
 */
export async function getSystemConfig(): Promise<SystemConfig | null> {
  const supabase = await createClient()

  const { data: user } = await supabase.auth.getUser()
  if (!user.user) {
    return null
  }

  const { data, error } = await supabase
    .from('system_config')
    .select('*')
    .limit(1)
    .single()

  if (error) {
    // 如果没有配置记录，返回默认值
    return {
      id: '',
      default_labor_cost_per_day: DEFAULT_CONFIG.LABOR_COST_PER_DAY,
      default_risk_buffer_percentage: DEFAULT_CONFIG.RISK_BUFFER_PERCENTAGE,
      currency: DEFAULT_CONFIG.CURRENCY,
      updated_at: new Date().toISOString(),
      updated_by: user.user.id,
    }
  }

  return data
}

/**
 * 更新系统配置
 */
export async function updateSystemConfig(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const { data: user } = await supabase.auth.getUser()
  if (!user.user) {
    return { success: false, error: '未登录' }
  }

  const laborCostPerDay = parseFloat(formData.get('labor_cost_per_day') as string)
  const riskBufferPercentage = parseFloat(formData.get('risk_buffer_percentage') as string)
  const currency = formData.get('currency') as string

  if (isNaN(laborCostPerDay) || isNaN(riskBufferPercentage)) {
    return { success: false, error: '请输入有效的数值' }
  }

  if (laborCostPerDay <= 0) {
    return { success: false, error: '人天成本必须大于 0' }
  }

  if (riskBufferPercentage < 0 || riskBufferPercentage > 100) {
    return { success: false, error: '风险缓冲比例必须在 0-100 之间' }
  }

  // 先检查是否存在配置记录
  const { data: existing } = await supabase
    .from('system_config')
    .select('id')
    .limit(1)
    .single()

  const configData = {
    default_labor_cost_per_day: laborCostPerDay,
    default_risk_buffer_percentage: riskBufferPercentage,
    currency: currency || 'CNY',
    updated_at: new Date().toISOString(),
    updated_by: user.user.id,
  }

  if (existing) {
    // 更新现有配置
    const { error } = await supabase
      .from('system_config')
      .update(configData)
      .eq('id', existing.id)

    if (error) {
      console.error('更新系统配置失败:', error)
      return { success: false, error: error.message }
    }
  } else {
    // 创建新配置
    const { error } = await supabase
      .from('system_config')
      .insert(configData)

    if (error) {
      console.error('创建系统配置失败:', error)
      return { success: false, error: error.message }
    }
  }

  revalidatePath('/settings')
  return { success: true }
}

/**
 * 获取用户个人资料
 */
export async function getUserProfile(): Promise<{
  email: string
  name: string | null
  avatar_url: string | null
} | null> {
  const supabase = await createClient()

  const { data: user } = await supabase.auth.getUser()
  if (!user.user) {
    return null
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, avatar_url')
    .eq('id', user.user.id)
    .single()

  return {
    email: user.user.email || '',
    name: profile?.full_name || null,
    avatar_url: profile?.avatar_url || null,
  }
}

/**
 * 更新用户个人资料
 */
export async function updateUserProfile(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const { data: user } = await supabase.auth.getUser()
  if (!user.user) {
    return { success: false, error: '未登录' }
  }

  const fullName = formData.get('full_name') as string

  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: fullName || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.user.id)

  if (error) {
    console.error('更新用户资料失败:', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/settings')
  return { success: true }
}
