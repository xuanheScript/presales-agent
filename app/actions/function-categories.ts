'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { FunctionCategory } from '@/types'

/**
 * 获取所有功能分类（按 sort_order 排序）
 */
export async function getFunctionCategories(): Promise<FunctionCategory[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('function_categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    console.error('获取功能分类失败:', error)
    return []
  }

  return data || []
}

/**
 * 获取分类名称列表（便捷方法）
 */
export async function getFunctionCategoryNames(): Promise<string[]> {
  const categories = await getFunctionCategories()
  return categories.map((c) => c.name)
}

/**
 * 创建功能分类
 */
export async function createFunctionCategory(
  name: string
): Promise<{ success: boolean; error?: string; id?: string }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: '请先登录' }
  }

  const trimmedName = name.trim()
  if (!trimmedName) {
    return { success: false, error: '请输入分类名称' }
  }

  // 获取当前最大 sort_order
  const { data: maxOrder } = await supabase
    .from('function_categories')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .single()

  const nextOrder = (maxOrder?.sort_order || 0) + 1

  const { data, error } = await supabase
    .from('function_categories')
    .insert({
      name: trimmedName,
      sort_order: nextOrder,
      is_preset: false,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { success: false, error: '该分类名称已存在' }
    }
    console.error('创建功能分类失败:', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/function-library')
  return { success: true, id: data.id }
}

/**
 * 更新功能分类名称
 */
export async function updateFunctionCategory(
  id: string,
  newName: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const trimmedName = newName.trim()
  if (!trimmedName) {
    return { success: false, error: '请输入分类名称' }
  }

  // 获取原分类信息
  const { data: category, error: fetchError } = await supabase
    .from('function_categories')
    .select('name, is_preset')
    .eq('id', id)
    .single()

  if (fetchError || !category) {
    return { success: false, error: '分类不存在' }
  }

  if (category.is_preset) {
    return { success: false, error: '预制分类不可修改' }
  }

  if (category.name === trimmedName) {
    return { success: true }
  }

  // 更新分类名称
  const { error: updateError } = await supabase
    .from('function_categories')
    .update({ name: trimmedName })
    .eq('id', id)

  if (updateError) {
    if (updateError.code === '23505') {
      return { success: false, error: '该分类名称已存在' }
    }
    console.error('更新功能分类失败:', updateError)
    return { success: false, error: updateError.message }
  }

  // 同步更新 function_library 中引用该分类的记录
  const { error: syncError } = await supabase
    .from('function_library')
    .update({ category: trimmedName })
    .eq('category', category.name)

  if (syncError) {
    console.error('同步更新功能库分类失败:', syncError)
  }

  revalidatePath('/function-library')
  return { success: true }
}

/**
 * 删除功能分类
 */
export async function deleteFunctionCategory(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  // 获取分类信息
  const { data: category, error: fetchError } = await supabase
    .from('function_categories')
    .select('name, is_preset')
    .eq('id', id)
    .single()

  if (fetchError || !category) {
    return { success: false, error: '分类不存在' }
  }

  if (category.is_preset) {
    return { success: false, error: '预制分类不可删除' }
  }

  // 检查是否有功能引用该分类
  const { count, error: countError } = await supabase
    .from('function_library')
    .select('id', { count: 'exact', head: true })
    .eq('category', category.name)

  if (countError) {
    console.error('查询分类引用失败:', countError)
    return { success: false, error: '查询失败' }
  }

  if (count && count > 0) {
    return {
      success: false,
      error: `该分类下有 ${count} 个功能，请先将这些功能移到其他分类后再删除`,
    }
  }

  const { error: deleteError } = await supabase
    .from('function_categories')
    .delete()
    .eq('id', id)

  if (deleteError) {
    console.error('删除功能分类失败:', deleteError)
    return { success: false, error: deleteError.message }
  }

  revalidatePath('/function-library')
  return { success: true }
}

/**
 * 获取分类的引用数量
 */
export async function getCategoryUsageCount(
  categoryName: string
): Promise<number> {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from('function_library')
    .select('id', { count: 'exact', head: true })
    .eq('category', categoryName)

  if (error) {
    console.error('查询分类引用数量失败:', error)
    return 0
  }

  return count || 0
}
