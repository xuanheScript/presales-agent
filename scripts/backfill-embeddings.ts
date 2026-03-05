/**
 * 一次性脚本：为现有 estimate_references 记录补充 embedding 向量
 *
 * 使用方式: npx tsx --env-file=.env.local scripts/backfill-embeddings.ts
 *
 * 前置条件:
 * 1. 已执行数据库迁移（embedding 列已创建）
 * 2. 已配置 DASHSCOPE_API_KEY 环境变量
 * 3. 已配置 NEXT_PUBLIC_SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 环境变量
 */

import { createClient } from '@supabase/supabase-js'

const DASHSCOPE_API_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings'
const EMBEDDING_MODEL = 'text-embedding-v4'
const EMBEDDING_DIMENSIONS = 1024

async function generateEmbeddings(
  texts: string[]
): Promise<number[][]> {
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY 未配置')

  const response = await fetch(DASHSCOPE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Embedding API 调用失败 (${response.status}): ${errorText}`)
  }

  const result = await response.json()
  return result.data
    .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
    .map((item: { embedding: number[] }) => item.embedding)
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    console.error('请配置 NEXT_PUBLIC_SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  // 查询所有没有 embedding 的记录
  const { data: refs, error } = await supabase
    .from('estimate_references')
    .select('id, module_name, function_name, description')
    .is('embedding', null)

  if (error) {
    console.error('查询失败:', error)
    process.exit(1)
  }

  if (!refs || refs.length === 0) {
    console.log('所有记录已有 embedding，无需回填')
    return
  }

  console.log(`找到 ${refs.length} 条需要回填的记录`)

  // 构建 embedding 文本
  const texts = refs.map((ref) =>
    [ref.module_name, ref.function_name, ref.description || '']
      .filter(Boolean)
      .join(' ')
  )

  // 批量生成 embedding（每次最多 10 条）
  for (let i = 0; i < texts.length; i += 10) {
    const batch = texts.slice(i, i + 10)
    const batchRefs = refs.slice(i, i + 10)

    console.log(`处理批次 ${Math.floor(i / 10) + 1}: ${batch.length} 条`)

    const embeddings = await generateEmbeddings(batch)

    for (let j = 0; j < batchRefs.length; j++) {
      const { error: updateError } = await supabase
        .from('estimate_references')
        .update({ embedding: JSON.stringify(embeddings[j]) })
        .eq('id', batchRefs[j].id)

      if (updateError) {
        console.error(`更新 ${batchRefs[j].id} 失败:`, updateError)
      } else {
        console.log(
          `  ✓ ${batchRefs[j].module_name} - ${batchRefs[j].function_name}`
        )
      }
    }
  }

  console.log('回填完成!')
}

main().catch(console.error)
