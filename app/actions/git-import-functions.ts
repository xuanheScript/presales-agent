'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

interface ImportFunctionItem {
  function_name: string
  category: string
  description: string
  standard_hours: number
}

interface ImportGroupItem {
  name: string
  description: string
  function_names: string[]
}

/**
 * 批量导入功能库项目和功能组
 *
 * 1. 批量创建功能库项目
 * 2. 根据 function_names 匹配 ID，批量创建功能组 + 关联记录
 */
export async function batchImportFunctions(input: {
  functions: ImportFunctionItem[]
  groups: ImportGroupItem[]
}): Promise<{
  success: boolean
  error?: string
  functionCount?: number
  groupCount?: number
}> {
  const supabase = await createClient()

  const { data: user } = await supabase.auth.getUser()
  if (!user.user) {
    return { success: false, error: '未登录' }
  }

  if (input.functions.length === 0) {
    return { success: false, error: '没有要导入的功能' }
  }

  // 1. 批量创建功能库项目
  const functionRecords = input.functions.map((f) => ({
    function_name: f.function_name,
    category: f.category,
    description: f.description || null,
    standard_hours: f.standard_hours,
    reference_cost: null,
    complexity_factors: null,
  }))

  const { data: createdFunctions, error: funcError } = await supabase
    .from('function_library')
    .insert(functionRecords)
    .select('id, function_name')

  if (funcError) {
    console.error('批量创建功能库项目失败:', funcError)
    return { success: false, error: `创建功能失败: ${funcError.message}` }
  }

  // 建立 function_name -> id 的映射
  const nameToId = new Map<string, string>()
  for (const f of createdFunctions || []) {
    nameToId.set(f.function_name, f.id)
  }

  // 2. 批量创建功能组
  let groupCount = 0

  for (const group of input.groups) {
    // 根据 function_names 查找对应的 function_library_id
    const functionIds = group.function_names
      .map((name) => nameToId.get(name))
      .filter((id): id is string => !!id)

    if (functionIds.length === 0) continue

    // 创建功能组
    const { data: createdGroup, error: groupError } = await supabase
      .from('function_groups')
      .insert({
        name: group.name,
        description: group.description || null,
        created_by: user.user.id,
      })
      .select('id')
      .single()

    if (groupError) {
      console.error('创建功能组失败:', groupError, group.name)
      continue
    }

    // 批量插入关联项
    const items = functionIds.map((funcId, index) => ({
      group_id: createdGroup.id,
      function_library_id: funcId,
      sort_order: index,
    }))

    const { error: itemsError } = await supabase
      .from('function_group_items')
      .insert(items)

    if (itemsError) {
      console.error('添加组内功能失败:', itemsError, group.name)
      // 回滚该组
      await supabase.from('function_groups').delete().eq('id', createdGroup.id)
      continue
    }

    groupCount++
  }

  revalidatePath('/function-library')

  return {
    success: true,
    functionCount: createdFunctions?.length || 0,
    groupCount,
  }
}
