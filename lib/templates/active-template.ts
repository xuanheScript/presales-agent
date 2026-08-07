import type { SupabaseClient } from '@supabase/supabase-js'
import type { Template, TemplateType } from '@/types'

export async function findActiveTemplateWithClient(
  supabase: SupabaseClient,
  templateType: TemplateType,
  industry?: string
): Promise<Template | null> {
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
    .maybeSingle()

  if (error) throw error
  if (!data && industry) {
    return findActiveTemplateWithClient(supabase, templateType)
  }

  return data as Template | null
}
