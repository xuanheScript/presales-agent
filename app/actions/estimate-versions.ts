'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type {
  EstimateVersion,
  EstimateVersionAdditionalWork,
  EstimateVersionCost,
  EstimateVersionFunction,
  EstimateVersionRole,
  EstimateVersionSnapshot,
} from '@/types'

export type EstimateVersionPointer = 'latest' | 'published'

interface EstimateVersionQuery {
  versionId?: string
  pointer?: EstimateVersionPointer
}

export async function getEstimateVersionSnapshot(
  projectId: string,
  query: EstimateVersionQuery = {}
): Promise<EstimateVersionSnapshot | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const pointer = query.pointer || 'latest'
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, latest_estimate_version_id, published_estimate_version_id')
    .eq('id', projectId)
    .eq('created_by', user.id)
    .maybeSingle()

  if (projectError || !project) return null

  const versionId = query.versionId || (
    pointer === 'published'
      ? project.published_estimate_version_id
      : project.latest_estimate_version_id
  )
  if (!versionId) return null

  const [versionResult, functionsResult, rolesResult, additionalWorkResult, costResult] = await Promise.all([
    supabase
      .from('estimate_versions')
      .select('*')
      .eq('id', versionId)
      .eq('project_id', projectId)
      .maybeSingle(),
    supabase
      .from('estimate_version_functions')
      .select('*')
      .eq('estimate_version_id', versionId)
      .eq('project_id', projectId)
      .order('sequence_no', { ascending: true }),
    supabase
      .from('estimate_version_roles')
      .select('*')
      .eq('estimate_version_id', versionId)
      .eq('project_id', projectId)
      .order('sequence_no', { ascending: true }),
    supabase
      .from('estimate_version_additional_work')
      .select('*')
      .eq('estimate_version_id', versionId)
      .eq('project_id', projectId)
      .order('sequence_no', { ascending: true }),
    supabase
      .from('estimate_version_costs')
      .select('*')
      .eq('estimate_version_id', versionId)
      .eq('project_id', projectId)
      .maybeSingle(),
  ])

  if (
    versionResult.error
    || functionsResult.error
    || rolesResult.error
    || additionalWorkResult.error
    || costResult.error
    || !versionResult.data
  ) {
    console.error('读取估算版本快照失败:', {
      version: versionResult.error,
      functions: functionsResult.error,
      roles: rolesResult.error,
      additionalWork: additionalWorkResult.error,
      cost: costResult.error,
    })
    return null
  }

  return {
    version: versionResult.data as EstimateVersion,
    functions: (functionsResult.data || []) as EstimateVersionFunction[],
    roles: (rolesResult.data || []) as EstimateVersionRole[],
    additionalWork: (additionalWorkResult.data || []) as EstimateVersionAdditionalWork[],
    cost: costResult.data as EstimateVersionCost | null,
    pointer: query.versionId ? 'explicit' : pointer,
  }
}

export async function publishEstimateVersion(
  projectId: string,
  estimateVersionId: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '请先登录' }

  const { error } = await supabase.rpc('publish_estimate_version', {
    p_project_id: projectId,
    p_estimate_version_id: estimateVersionId,
  })
  if (error) {
    return { error: error.code === '40001' ? '只能发布项目当前最新估算版本' : error.message }
  }
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/estimation`)
  revalidatePath(`/projects/${projectId}/estimation/versions`)
  revalidatePath(`/projects/${projectId}/report`)
  return { success: true }
}

export async function listEstimateVersions(projectId: string): Promise<EstimateVersion[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('created_by', user.id)
    .maybeSingle()
  if (!project) return []

  const { data, error } = await supabase
    .from('estimate_versions')
    .select('*')
    .eq('project_id', projectId)
    .order('revision_no', { ascending: false })

  if (error) {
    console.error('读取估算版本列表失败:', error)
    return []
  }
  return (data || []) as EstimateVersion[]
}
