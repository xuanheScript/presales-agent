import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { generateEmbedding } from '@/lib/ai/embedding'
import { isAbortError } from './execution-policy'
import type { EstimateReference } from '@/types'

const DEFAULT_REFERENCE_LIMIT = 10
const MAX_REFERENCE_LIMIT = 20
const REFERENCE_SELECT_COLUMNS = [
  'id',
  'module_name',
  'function_name',
  'description',
  'difficulty_level',
  'role_estimates',
  'estimated_hours',
  'project_type',
  'category',
  'industry',
  'tech_stack',
  'source_project_id',
  'source_function_module_id',
  'usage_count',
  'verified_by',
  'created_at',
  'updated_at',
].join(', ')

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_REFERENCE_LIMIT
  return Math.min(MAX_REFERENCE_LIMIT, Math.max(1, Math.trunc(limit)))
}

export async function getReferencesForBreakdownInWorker(
  queryText: string,
  limit: number = DEFAULT_REFERENCE_LIMIT,
  options: { signal?: AbortSignal } = {}
): Promise<EstimateReference[]> {
  const supabase = createAdminClient()
  const matchCount = normalizeLimit(limit)

  try {
    const queryEmbedding = await generateEmbedding(queryText, {
      signal: options.signal,
    })
    let vectorQuery = supabase.rpc('match_estimate_references', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: 0.3,
      match_count: matchCount,
    })
    if (options.signal) {
      vectorQuery = vectorQuery.abortSignal(options.signal)
    }
    const { data, error } = await vectorQuery

    if (!error && data && data.length > 0) {
      console.log('[RAG] Worker 向量检索命中:', {
        query: queryText.substring(0, 100),
        resultCount: data.length,
        similarities: data.map((item: EstimateReference & { similarity: number }) =>
          item.similarity?.toFixed(3)
        ),
      })
      return data
    }
  } catch (error) {
    if (isAbortError(error, options.signal)) throw error
    console.warn('[RAG] Worker 向量检索失败，回退到全局高频参考:', error)
  }

  let fallbackQuery = supabase
    .from('estimate_references')
    .select(REFERENCE_SELECT_COLUMNS)
    .order('usage_count', { ascending: false })
    .limit(matchCount)
  if (options.signal) {
    fallbackQuery = fallbackQuery.abortSignal(options.signal)
  }
  const { data, error } = await fallbackQuery
  if (error) {
    console.warn('[RAG] Worker 全局参考查询失败:', error)
    return []
  }
  return (data || []) as unknown as EstimateReference[]
}

export async function incrementReferenceUsageInWorker(ids: string[]): Promise<void> {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length === 0) return

  const supabase = createAdminClient()
  await Promise.all(uniqueIds.map(async (id) => {
    const { error } = await supabase.rpc('increment_estimate_reference_usage', {
      reference_id: id,
    })
    if (error) {
      console.warn('[RAG] Worker 更新参考使用计数失败:', { id, error })
    }
  }))
}
