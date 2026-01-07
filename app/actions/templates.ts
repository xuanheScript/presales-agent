'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Template, TemplateType } from '@/types'

/**
 * 获取所有模板
 */
export async function getTemplates(): Promise<Template[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .order('template_type', { ascending: true })
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('获取模板失败:', error)
    return []
  }

  return data || []
}

/**
 * 获取单个模板
 */
export async function getTemplate(id: string): Promise<Template | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('获取模板失败:', error)
    return null
  }

  return data
}

/**
 * 获取指定类型的活跃模板
 */
export async function getActiveTemplate(
  templateType: TemplateType,
  industry?: string
): Promise<Template | null> {
  const supabase = await createClient()

  let query = supabase
    .from('templates')
    .select('*')
    .eq('template_type', templateType)
    .eq('is_active', true)

  if (industry) {
    query = query.eq('industry', industry)
  }

  const { data, error } = await query
    .order('version', { ascending: false })
    .limit(1)
    .single()

  if (error) {
    // 如果找不到特定行业的模板，尝试获取通用模板
    if (industry) {
      return getActiveTemplate(templateType)
    }
    console.error('获取活跃模板失败:', error)
    return null
  }

  return data
}

/**
 * 创建模板
 */
export async function createTemplate(formData: FormData): Promise<{ success: boolean; error?: string; id?: string }> {
  const supabase = await createClient()

  const templateType = formData.get('template_type') as TemplateType
  const templateName = formData.get('template_name') as string
  const promptContent = formData.get('prompt_content') as string
  const industryValue = formData.get('industry') as string | null
  // 将 __all__ 转换为 null 表示通用
  const industry = industryValue === '__all__' ? null : industryValue

  if (!templateType || !templateName || !promptContent) {
    return { success: false, error: '请填写必要字段' }
  }

  const { data, error } = await supabase
    .from('templates')
    .insert({
      template_type: templateType,
      template_name: templateName,
      prompt_content: promptContent,
      industry: industry,
      version: '1.0.0',
      is_active: true,
    })
    .select('id')
    .single()

  if (error) {
    console.error('创建模板失败:', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/templates')
  return { success: true, id: data.id }
}

/**
 * 更新模板（创建新版本）
 */
export async function updateTemplate(
  id: string,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const templateName = formData.get('template_name') as string
  const promptContent = formData.get('prompt_content') as string
  const industryValue = formData.get('industry') as string | null
  // 将 __all__ 转换为 null 表示通用
  const industry = industryValue === '__all__' ? null : industryValue
  const isActive = formData.get('is_active') === 'true'
  const createNewVersion = formData.get('create_new_version') === 'true'

  if (!templateName || !promptContent) {
    return { success: false, error: '请填写必要字段' }
  }

  // 获取当前模板信息
  const currentTemplate = await getTemplate(id)
  if (!currentTemplate) {
    return { success: false, error: '模板不存在' }
  }

  if (createNewVersion) {
    // 递增版本号
    const versionParts = currentTemplate.version.split('.').map(Number)
    versionParts[1] += 1 // 递增次版本号
    const newVersion = versionParts.join('.')

    // 将旧版本设为非活跃
    await supabase
      .from('templates')
      .update({ is_active: false })
      .eq('id', id)

    // 创建新版本
    const { error } = await supabase
      .from('templates')
      .insert({
        template_type: currentTemplate.template_type,
        template_name: templateName,
        prompt_content: promptContent,
        industry: industry || null,
        version: newVersion,
        is_active: true,
      })

    if (error) {
      console.error('创建新版本失败:', error)
      return { success: false, error: error.message }
    }
  } else {
    // 直接更新当前模板
    const { error } = await supabase
      .from('templates')
      .update({
        template_name: templateName,
        prompt_content: promptContent,
        industry: industry || null,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) {
      console.error('更新模板失败:', error)
      return { success: false, error: error.message }
    }
  }

  revalidatePath('/templates')
  revalidatePath(`/templates/${id}`)
  return { success: true }
}

/**
 * 删除模板
 */
export async function deleteTemplate(id: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('templates')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('删除模板失败:', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/templates')
  return { success: true }
}

/**
 * 切换模板激活状态
 */
export async function toggleTemplateActive(id: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const template = await getTemplate(id)
  if (!template) {
    return { success: false, error: '模板不存在' }
  }

  const { error } = await supabase
    .from('templates')
    .update({ is_active: !template.is_active })
    .eq('id', id)

  if (error) {
    console.error('切换模板状态失败:', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/templates')
  return { success: true }
}
