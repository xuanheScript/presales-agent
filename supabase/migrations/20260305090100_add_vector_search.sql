-- =============================================
-- 向量检索功能迁移
-- 1. 启用 pgvector 扩展
-- 2. estimate_references 表添加 embedding 列
-- 3. 创建向量相似度检索 RPC 函数
-- =============================================

-- 1. 启用 pgvector 扩展
create extension if not exists vector with schema extensions;

-- 2. 添加 embedding 列（1024 维，阿里 text-embedding-v4 默认维度）
alter table estimate_references
  add column if not exists embedding vector(1024);

-- 3. 创建向量相似度检索函数
create or replace function match_estimate_references(
  query_embedding vector(1024),
  match_threshold float default 0.3,
  match_count int default 10
)
returns table (
  id uuid,
  module_name text,
  function_name text,
  description text,
  difficulty_level text,
  role_estimates jsonb,
  estimated_hours decimal,
  project_type text,
  category text,
  industry text,
  tech_stack text[],
  source_project_id uuid,
  source_function_module_id uuid,
  usage_count integer,
  verified_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  similarity float
)
language plpgsql as $$
begin
  return query
  select
    er.id,
    er.module_name,
    er.function_name,
    er.description,
    er.difficulty_level,
    er.role_estimates,
    er.estimated_hours,
    er.project_type,
    er.category,
    er.industry,
    er.tech_stack,
    er.source_project_id,
    er.source_function_module_id,
    er.usage_count,
    er.verified_by,
    er.created_at,
    er.updated_at,
    1 - (er.embedding <=> query_embedding) as similarity
  from estimate_references er
  where er.embedding is not null
    and 1 - (er.embedding <=> query_embedding) > match_threshold
  order by er.embedding <=> query_embedding
  limit match_count;
end;
$$;
