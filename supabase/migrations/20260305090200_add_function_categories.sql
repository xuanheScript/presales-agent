-- 创建功能分类表
CREATE TABLE IF NOT EXISTS function_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_preset BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT function_categories_name_unique UNIQUE (name)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_function_categories_sort_order ON function_categories(sort_order, name);

-- 创建 updated_at 触发器
CREATE TRIGGER update_function_categories_updated_at
  BEFORE UPDATE ON function_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 启用 RLS
ALTER TABLE function_categories ENABLE ROW LEVEL SECURITY;

-- RLS 策略：所有认证用户可读
CREATE POLICY "认证用户可以查看功能分类"
  ON function_categories FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- RLS 策略：认证用户可以创建分类
CREATE POLICY "认证用户可以创建功能分类"
  ON function_categories FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- RLS 策略：只能更新非预制分类
CREATE POLICY "认证用户可以更新非预制功能分类"
  ON function_categories FOR UPDATE
  USING (auth.uid() IS NOT NULL AND is_preset = FALSE);

-- RLS 策略：只能删除非预制分类
CREATE POLICY "认证用户可以删除非预制功能分类"
  ON function_categories FOR DELETE
  USING (auth.uid() IS NOT NULL AND is_preset = FALSE);

-- 插入预制分类数据
INSERT INTO function_categories (name, sort_order, is_preset) VALUES
  ('用户管理', 1, TRUE),
  ('权限系统', 2, TRUE),
  ('订单管理', 3, TRUE),
  ('支付系统', 4, TRUE),
  ('内容管理', 5, TRUE),
  ('数据分析', 6, TRUE),
  ('通知系统', 7, TRUE),
  ('搜索功能', 8, TRUE),
  ('文件管理', 9, TRUE),
  ('报表系统', 10, TRUE),
  ('工作流', 11, TRUE),
  ('集成接口', 12, TRUE),
  ('其他', 13, TRUE)
ON CONFLICT (name) DO NOTHING;
