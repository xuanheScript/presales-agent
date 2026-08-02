-- =============================================
-- 估算参考库功能迁移
-- 1. function_modules 表添加 is_verified 列
-- 2. 新建 estimate_references 表
-- =============================================

-- 1. function_modules 添加验证标记
ALTER TABLE function_modules
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN function_modules.is_verified IS '是否已验证为准确估算，标记后可提取到估算参考库';

-- 2. 新建估算参考库表
CREATE TABLE IF NOT EXISTS estimate_references (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- 功能描述（从 function_modules 提取）
  module_name TEXT NOT NULL,
  function_name TEXT NOT NULL,
  description TEXT,
  difficulty_level TEXT NOT NULL DEFAULT 'medium'
    CHECK (difficulty_level IN ('simple', 'medium', 'complex', 'very_complex')),

  -- 角色工时（核心数据）
  role_estimates JSONB NOT NULL DEFAULT '[]',
  -- 格式: [{role: string, days: number, reason?: string}]

  -- 总工时（小时）
  estimated_hours DECIMAL(10, 2) NOT NULL DEFAULT 0,

  -- 项目上下文（用于检索匹配）
  project_type TEXT,
  category TEXT,
  industry TEXT,
  tech_stack TEXT[],

  -- 溯源信息
  source_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  source_function_module_id UUID,  -- 不做 FK 约束，原模块可能被删

  -- 使用统计
  usage_count INTEGER NOT NULL DEFAULT 0,

  -- 审计
  verified_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_estimate_references_project_type
  ON estimate_references(project_type);
CREATE INDEX IF NOT EXISTS idx_estimate_references_category
  ON estimate_references(category);
CREATE INDEX IF NOT EXISTS idx_estimate_references_module_name
  ON estimate_references(module_name);

-- 更新时间触发器
CREATE TRIGGER update_estimate_references_updated_at
  BEFORE UPDATE ON estimate_references
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 启用 RLS
ALTER TABLE estimate_references ENABLE ROW LEVEL SECURITY;

-- RLS 策略
CREATE POLICY "认证用户可以查看估算参考库" ON estimate_references
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "认证用户可以添加估算参考" ON estimate_references
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "创建者可以更新估算参考" ON estimate_references
  FOR UPDATE USING (auth.uid() = verified_by);

CREATE POLICY "创建者可以删除估算参考" ON estimate_references
  FOR DELETE USING (auth.uid() = verified_by);

-- 3. RPC 函数：原子性递增使用计数
CREATE OR REPLACE FUNCTION increment_estimate_reference_usage(reference_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE estimate_references
  SET usage_count = usage_count + 1
  WHERE id = reference_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
