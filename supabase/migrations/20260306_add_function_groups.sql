-- ============================================
-- 功能组（Group）v2.0
-- 支持将多个功能打包成组，在快速估算中批量添加
-- ============================================

-- 1. 功能组主表
CREATE TABLE IF NOT EXISTS function_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  is_preset BOOLEAN NOT NULL DEFAULT FALSE,
  item_count INTEGER NOT NULL DEFAULT 0,
  total_standard_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 功能组-功能关联表（多对多）
CREATE TABLE IF NOT EXISTS function_group_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES function_groups(id) ON DELETE CASCADE,
  function_library_id UUID NOT NULL REFERENCES function_library(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, function_library_id)
);

-- 3. 索引
CREATE INDEX IF NOT EXISTS idx_function_groups_created_by ON function_groups(created_by);
CREATE INDEX IF NOT EXISTS idx_function_groups_created_at ON function_groups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_function_group_items_group_id ON function_group_items(group_id);
CREATE INDEX IF NOT EXISTS idx_function_group_items_function_library_id ON function_group_items(function_library_id);

-- 4. 更新时间触发器
CREATE TRIGGER update_function_groups_updated_at BEFORE UPDATE ON function_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. 自动维护冗余统计字段的触发器
CREATE OR REPLACE FUNCTION update_function_group_stats()
RETURNS TRIGGER AS $$
DECLARE
  target_group_id UUID;
BEGIN
  target_group_id := COALESCE(NEW.group_id, OLD.group_id);

  UPDATE function_groups
  SET
    item_count = (
      SELECT COUNT(*) FROM function_group_items WHERE group_id = target_group_id
    ),
    total_standard_hours = (
      SELECT COALESCE(SUM(fl.standard_hours), 0)
      FROM function_group_items fgi
      JOIN function_library fl ON fl.id = fgi.function_library_id
      WHERE fgi.group_id = target_group_id
    )
  WHERE id = target_group_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_group_stats_after_item_change
  AFTER INSERT OR DELETE ON function_group_items
  FOR EACH ROW EXECUTE FUNCTION update_function_group_stats();

-- 6. RLS 策略
ALTER TABLE function_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE function_group_items ENABLE ROW LEVEL SECURITY;

-- function_groups: 所有认证用户可读
CREATE POLICY "认证用户可以查看所有功能组" ON function_groups
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- function_groups: 认证用户可创建
CREATE POLICY "认证用户可以创建功能组" ON function_groups
  FOR INSERT WITH CHECK (auth.uid() = created_by);

-- function_groups: 创建者可更新自己的非预设组
CREATE POLICY "用户可以更新自己创建的功能组" ON function_groups
  FOR UPDATE USING (auth.uid() = created_by AND is_preset = FALSE);

-- function_groups: 创建者可删除自己的非预设组
CREATE POLICY "用户可以删除自己创建的功能组" ON function_groups
  FOR DELETE USING (auth.uid() = created_by AND is_preset = FALSE);

-- function_group_items: 所有认证用户可读
CREATE POLICY "认证用户可以查看功能组内容" ON function_group_items
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- function_group_items: 组的创建者可以添加内容
CREATE POLICY "用户可以添加自己功能组的内容" ON function_group_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM function_groups
      WHERE function_groups.id = function_group_items.group_id
      AND function_groups.created_by = auth.uid()
    )
  );

-- function_group_items: 组的创建者可以更新排序
CREATE POLICY "用户可以更新自己功能组的内容排序" ON function_group_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM function_groups
      WHERE function_groups.id = function_group_items.group_id
      AND function_groups.created_by = auth.uid()
    )
  );

-- function_group_items: 组的创建者可以删除内容
CREATE POLICY "用户可以删除自己功能组的内容" ON function_group_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM function_groups
      WHERE function_groups.id = function_group_items.group_id
      AND function_groups.created_by = auth.uid()
    )
  );
