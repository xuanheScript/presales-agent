'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type {
  FunctionGroup,
  FunctionGroupWithItems,
  FunctionGroupInput,
  FunctionGroupItemDetail,
} from '@/types'

/**
 * 获取所有功能组列表（不含组内功能详情）
 */
export async function getFunctionGroups(): Promise<FunctionGroup[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('function_groups')
    .select('*')
    .order('is_preset', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    console.error('获取功能组列表失败:', error)
    return []
  }

  return data || []
}

/**
 * 获取单个功能组（含组内功能详情）
 */
export async function getFunctionGroupWithItems(
  groupId: string
): Promise<FunctionGroupWithItems | null> {
  const supabase = await createClient()

  const { data: group, error: groupError } = await supabase
    .from('function_groups')
    .select('*')
    .eq('id', groupId)
    .single()

  if (groupError || !group) {
    console.error('获取功能组失败:', groupError)
    return null
  }

  const { data: items, error: itemsError } = await supabase
    .from('function_group_items')
    .select(`
      id,
      function_library_id,
      sort_order,
      function_library (
        function_name,
        category,
        description,
        standard_hours,
        complexity_factors
      )
    `)
    .eq('group_id', groupId)
    .order('sort_order', { ascending: true })

  if (itemsError) {
    console.error('获取功能组内容失败:', itemsError)
    return { ...group, items: [] }
  }

  const flatItems: FunctionGroupItemDetail[] = (items || []).map((item: Record<string, unknown>) => {
    const fl = item.function_library as Record<string, unknown>
    return {
      id: item.id as string,
      function_library_id: item.function_library_id as string,
      sort_order: item.sort_order as number,
      function_name: fl.function_name as string,
      category: fl.category as string,
      description: fl.description as string | null,
      standard_hours: fl.standard_hours as number,
      complexity_factors: fl.complexity_factors as Record<string, number> | null,
    }
  })

  return { ...group, items: flatItems }
}

/**
 * 获取所有功能组（含组内功能详情），用于快速估算页面
 */
export async function getAllFunctionGroupsWithItems(): Promise<FunctionGroupWithItems[]> {
  const supabase = await createClient()

  const { data: groups, error: groupsError } = await supabase
    .from('function_groups')
    .select('*')
    .order('is_preset', { ascending: false })
    .order('created_at', { ascending: false })

  if (groupsError || !groups?.length) {
    return []
  }

  const groupIds = groups.map((g) => g.id)

  const { data: allItems, error: itemsError } = await supabase
    .from('function_group_items')
    .select(`
      id,
      group_id,
      function_library_id,
      sort_order,
      function_library (
        function_name,
        category,
        description,
        standard_hours,
        complexity_factors
      )
    `)
    .in('group_id', groupIds)
    .order('sort_order', { ascending: true })

  if (itemsError) {
    console.error('获取功能组内容失败:', itemsError)
    return groups.map((g) => ({ ...g, items: [] }))
  }

  // 按 group_id 分组
  const itemsByGroup = new Map<string, FunctionGroupItemDetail[]>()
  for (const item of allItems || []) {
    const fl = (item as Record<string, unknown>).function_library as Record<string, unknown>
    const detail: FunctionGroupItemDetail = {
      id: item.id,
      function_library_id: item.function_library_id,
      sort_order: item.sort_order,
      function_name: fl.function_name as string,
      category: fl.category as string,
      description: fl.description as string | null,
      standard_hours: fl.standard_hours as number,
      complexity_factors: fl.complexity_factors as Record<string, number> | null,
    }
    const list = itemsByGroup.get(item.group_id) || []
    list.push(detail)
    itemsByGroup.set(item.group_id, list)
  }

  return groups.map((g) => ({
    ...g,
    items: itemsByGroup.get(g.id) || [],
  }))
}

/**
 * 创建功能组
 */
export async function createFunctionGroup(
  input: FunctionGroupInput
): Promise<{ success: boolean; error?: string; id?: string }> {
  const supabase = await createClient()

  const { data: user } = await supabase.auth.getUser()
  if (!user.user) {
    return { success: false, error: '未登录' }
  }

  if (!input.name.trim()) {
    return { success: false, error: '请输入组名称' }
  }

  if (input.function_library_ids.length === 0) {
    return { success: false, error: '请至少选择一个功能' }
  }

  // 创建组（item_count 和 total_standard_hours 由触发器自动维护）
  const { data: group, error: groupError } = await supabase
    .from('function_groups')
    .insert({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      created_by: user.user.id,
    })
    .select('id')
    .single()

  if (groupError) {
    console.error('创建功能组失败:', groupError)
    return { success: false, error: groupError.message }
  }

  // 批量插入关联项
  const items = input.function_library_ids.map((funcId, index) => ({
    group_id: group.id,
    function_library_id: funcId,
    sort_order: index,
  }))

  const { error: itemsError } = await supabase
    .from('function_group_items')
    .insert(items)

  if (itemsError) {
    console.error('添加组内功能失败:', itemsError)
    // 回滚：删除已创建的组
    await supabase.from('function_groups').delete().eq('id', group.id)
    return { success: false, error: itemsError.message }
  }

  revalidatePath('/function-library')
  return { success: true, id: group.id }
}

/**
 * 更新功能组
 */
export async function updateFunctionGroup(
  groupId: string,
  input: FunctionGroupInput
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const { data: user } = await supabase.auth.getUser()
  if (!user.user) {
    return { success: false, error: '未登录' }
  }

  if (!input.name.trim()) {
    return { success: false, error: '请输入组名称' }
  }

  if (input.function_library_ids.length === 0) {
    return { success: false, error: '请至少选择一个功能' }
  }

  // 更新组基础信息（RLS 策略确保只有非预设组可被编辑）
  const { data: updatedGroup, error: groupError } = await supabase
    .from('function_groups')
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
    })
    .eq('id', groupId)
    .select('id')

  if (groupError) {
    console.error('更新功能组失败:', groupError)
    return { success: false, error: groupError.message }
  }

  if (!updatedGroup || updatedGroup.length === 0) {
    return { success: false, error: '功能组不存在或无权编辑' }
  }

  // 删除旧的关联，重新插入
  const { error: deleteError } = await supabase
    .from('function_group_items')
    .delete()
    .eq('group_id', groupId)

  if (deleteError) {
    console.error('删除旧关联失败:', deleteError)
    return { success: false, error: deleteError.message }
  }

  const items = input.function_library_ids.map((funcId, index) => ({
    group_id: groupId,
    function_library_id: funcId,
    sort_order: index,
  }))

  const { error: itemsError } = await supabase
    .from('function_group_items')
    .insert(items)

  if (itemsError) {
    console.error('更新组内功能失败:', itemsError)
    return { success: false, error: itemsError.message }
  }

  revalidatePath('/function-library')
  return { success: true }
}

/**
 * 删除功能组
 */
export async function deleteFunctionGroup(
  groupId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('function_groups')
    .delete()
    .eq('id', groupId)

  if (error) {
    console.error('删除功能组失败:', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/function-library')
  return { success: true }
}
