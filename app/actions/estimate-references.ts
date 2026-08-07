'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  generateEmbedding,
  generateEmbeddings,
  buildEmbeddingText,
} from '@/lib/ai/embedding'
import type { EstimateReference } from '@/types'

/**
 * 获取估算参考列表（支持筛选）
 */
export async function getEstimateReferences(options?: {
  projectType?: string
  category?: string
  search?: string
  limit?: number
}): Promise<EstimateReference[]> {
  const supabase = await createClient()

  let query = supabase
    .from('estimate_references')
    .select('*')
    .order('usage_count', { ascending: false })
    .order('created_at', { ascending: false })

  if (options?.projectType) {
    query = query.eq('project_type', options.projectType)
  }

  if (options?.category) {
    query = query.eq('category', options.category)
  }

  if (options?.search) {
    query = query.or(
      `function_name.ilike.%${options.search}%,module_name.ilike.%${options.search}%,description.ilike.%${options.search}%`
    )
  }

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  const { data, error } = await query

  if (error) {
    console.error('获取估算参考失败:', error)
    return []
  }

  return data || []
}

/**
 * 将已验证的 function_module 提取到参考库
 */
export async function extractToReference(
  functionModuleId: string,
  metadata: {
    projectType?: string
    category?: string
    industry?: string
    techStack?: string[]
  }
): Promise<{ success: boolean; error?: string; id?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: '请先登录' }
  }

  // 获取功能模块数据
  const { data: fm, error: fmError } = await supabase
    .from('function_modules')
    .select('*, projects!inner(id, created_by)')
    .eq('id', functionModuleId)
    .single()

  if (fmError || !fm) {
    return { success: false, error: '功能模块不存在' }
  }

  // 检查权限
  if (fm.projects.created_by !== user.id) {
    return { success: false, error: '无权限操作此功能模块' }
  }

  // 检查是否已提取过
  const { data: existing } = await supabase
    .from('estimate_references')
    .select('id')
    .eq('source_function_module_id', functionModuleId)
    .maybeSingle()

  if (existing) {
    return { success: false, error: '该功能模块已存在于参考库中' }
  }

  // 插入参考库
  const { data: ref, error: insertError } = await supabase
    .from('estimate_references')
    .insert({
      module_name: fm.module_name,
      function_name: fm.function_name,
      description: fm.description,
      difficulty_level: fm.difficulty_level,
      role_estimates: fm.role_estimates || [],
      estimated_hours: fm.estimated_hours,
      project_type: metadata.projectType || null,
      category: metadata.category || null,
      industry: metadata.industry || null,
      tech_stack: metadata.techStack || null,
      source_project_id: fm.project_id,
      source_function_module_id: functionModuleId,
      verified_by: user.id,
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('提取到参考库失败:', insertError)
    return { success: false, error: insertError.message }
  }

  // 异步生成 embedding（不阻塞主流程）
  const embeddingText = buildEmbeddingText({
    module_name: fm.module_name,
    function_name: fm.function_name,
    description: fm.description,
  })
  generateEmbedding(embeddingText)
    .then(async (embedding) => {
      const supabaseForUpdate = await createClient()
      await supabaseForUpdate
        .from('estimate_references')
        .update({ embedding: JSON.stringify(embedding) })
        .eq('id', ref.id)
    })
    .catch((err) => console.warn('[RAG] 生成 embedding 失败:', err))

  revalidatePath('/function-library')
  return { success: true, id: ref.id }
}

/**
 * 批量提取已验证的功能模块到参考库
 */
export async function batchExtractToReferences(
  projectId: string,
  metadata: {
    projectType?: string
    category?: string
    industry?: string
    techStack?: string[]
  }
): Promise<{ success: boolean; error?: string; count?: number }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: '请先登录' }
  }

  // 获取该项目所有已验证的功能模块
  const { data: modules, error: queryError } = await supabase
    .from('function_modules')
    .select('*, projects!inner(id, created_by)')
    .eq('project_id', projectId)
    .eq('is_verified', true)
    .eq('projects.created_by', user.id)

  if (queryError || !modules || modules.length === 0) {
    return { success: false, error: '没有找到已验证的功能模块' }
  }

  // 获取已提取过的模块 ID
  const moduleIds = modules.map((m) => m.id)
  const { data: existingRefs } = await supabase
    .from('estimate_references')
    .select('source_function_module_id')
    .in('source_function_module_id', moduleIds)

  const existingModuleIds = new Set(
    (existingRefs || []).map((r) => r.source_function_module_id)
  )

  // 过滤掉已提取的模块
  const newModules = modules.filter((m) => !existingModuleIds.has(m.id))

  if (newModules.length === 0) {
    return { success: false, error: '所有已验证模块均已在参考库中' }
  }

  // 批量插入
  const references = newModules.map((fm) => ({
    module_name: fm.module_name,
    function_name: fm.function_name,
    description: fm.description,
    difficulty_level: fm.difficulty_level,
    role_estimates: fm.role_estimates || [],
    estimated_hours: fm.estimated_hours,
    project_type: metadata.projectType || null,
    category: metadata.category || null,
    industry: metadata.industry || null,
    tech_stack: metadata.techStack || null,
    source_project_id: projectId,
    source_function_module_id: fm.id,
    verified_by: user.id,
  }))

  const { data: insertedRefs, error: insertError } = await supabase
    .from('estimate_references')
    .insert(references)
    .select('id, module_name, function_name, description')

  if (insertError) {
    console.error('批量提取到参考库失败:', insertError)
    return { success: false, error: insertError.message }
  }

  // 异步批量生成 embedding（不阻塞主流程）
  if (insertedRefs && insertedRefs.length > 0) {
    const texts = insertedRefs.map((ref) => buildEmbeddingText(ref))
    generateEmbeddings(texts)
      .then(async (embeddings) => {
        const supabaseForUpdate = await createClient()
        for (let i = 0; i < insertedRefs.length; i++) {
          await supabaseForUpdate
            .from('estimate_references')
            .update({ embedding: JSON.stringify(embeddings[i]) })
            .eq('id', insertedRefs[i].id)
        }
        console.log('[RAG] 批量 embedding 生成完成:', insertedRefs.length)
      })
      .catch((err) => console.warn('[RAG] 批量生成 embedding 失败:', err))
  }

  revalidatePath('/function-library')
  return { success: true, count: references.length }
}

/**
 * 删除估算参考
 */
export async function deleteEstimateReference(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('estimate_references')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('删除估算参考失败:', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/function-library')
  return { success: true }
}

/**
 * 获取参考库统计信息
 */
export async function getEstimateReferenceStats(): Promise<{
  totalCount: number
  projectTypes: string[]
  categories: string[]
}> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('estimate_references')
    .select('project_type, category')

  if (error || !data) {
    return { totalCount: 0, projectTypes: [], categories: [] }
  }

  const projectTypes = [
    ...new Set(data.map((d) => d.project_type).filter(Boolean) as string[]),
  ]
  const categories = [
    ...new Set(data.map((d) => d.category).filter(Boolean) as string[]),
  ]

  return {
    totalCount: data.length,
    projectTypes: projectTypes.sort(),
    categories: categories.sort(),
  }
}
