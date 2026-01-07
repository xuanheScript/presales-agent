'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { FunctionLibraryItem } from '@/types'

/**
 * 获取所有功能库项目
 */
export async function getFunctionLibraryItems(
  options?: {
    category?: string
    search?: string
  }
): Promise<FunctionLibraryItem[]> {
  const supabase = await createClient()

  let query = supabase
    .from('function_library')
    .select('*')
    .order('category', { ascending: true })
    .order('function_name', { ascending: true })

  if (options?.category) {
    query = query.eq('category', options.category)
  }

  if (options?.search) {
    query = query.ilike('function_name', `%${options.search}%`)
  }

  const { data, error } = await query

  if (error) {
    console.error('获取功能库失败:', error)
    return []
  }

  return data || []
}

/**
 * 获取单个功能库项目
 */
export async function getFunctionLibraryItem(id: string): Promise<FunctionLibraryItem | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('function_library')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('获取功能库项目失败:', error)
    return null
  }

  return data
}

/**
 * 创建功能库项目
 */
export async function createFunctionLibraryItem(
  formData: FormData
): Promise<{ success: boolean; error?: string; id?: string }> {
  const supabase = await createClient()

  const functionName = formData.get('function_name') as string
  const category = formData.get('category') as string
  const description = formData.get('description') as string | null
  const standardHours = parseFloat(formData.get('standard_hours') as string)
  const referenceCost = formData.get('reference_cost')
    ? parseFloat(formData.get('reference_cost') as string)
    : null

  if (!functionName || !category || isNaN(standardHours)) {
    return { success: false, error: '请填写必要字段' }
  }

  const { data, error } = await supabase
    .from('function_library')
    .insert({
      function_name: functionName,
      category: category,
      description: description || null,
      standard_hours: standardHours,
      reference_cost: referenceCost,
      complexity_factors: null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('创建功能库项目失败:', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/function-library')
  return { success: true, id: data.id }
}

/**
 * 更新功能库项目
 */
export async function updateFunctionLibraryItem(
  id: string,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const functionName = formData.get('function_name') as string
  const category = formData.get('category') as string
  const description = formData.get('description') as string | null
  const standardHours = parseFloat(formData.get('standard_hours') as string)
  const referenceCost = formData.get('reference_cost')
    ? parseFloat(formData.get('reference_cost') as string)
    : null

  if (!functionName || !category || isNaN(standardHours)) {
    return { success: false, error: '请填写必要字段' }
  }

  const { error } = await supabase
    .from('function_library')
    .update({
      function_name: functionName,
      category: category,
      description: description || null,
      standard_hours: standardHours,
      reference_cost: referenceCost,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    console.error('更新功能库项目失败:', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/function-library')
  return { success: true }
}

/**
 * 删除功能库项目
 */
export async function deleteFunctionLibraryItem(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('function_library')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('删除功能库项目失败:', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/function-library')
  return { success: true }
}

/**
 * 获取功能分类列表
 */
export async function getFunctionCategories(): Promise<string[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('function_library')
    .select('category')

  if (error) {
    console.error('获取分类失败:', error)
    return []
  }

  // 去重
  const categories = [...new Set(data?.map((item) => item.category) || [])]
  return categories.sort()
}

/**
 * 搜索功能库
 */
export async function searchFunctionLibrary(
  keyword: string,
  category?: string
): Promise<FunctionLibraryItem[]> {
  const supabase = await createClient()

  let query = supabase
    .from('function_library')
    .select('*')
    .ilike('function_name', `%${keyword}%`)
    .order('category', { ascending: true })
    .limit(10)

  if (category) {
    query = query.eq('category', category)
  }

  const { data, error } = await query

  if (error) {
    console.error('搜索功能库失败:', error)
    return []
  }

  return data || []
}
