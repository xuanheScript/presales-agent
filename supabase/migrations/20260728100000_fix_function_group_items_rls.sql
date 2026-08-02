-- ============================================
-- 修复 function_groups 和 function_group_items 的 RLS 策略
-- 原策略要求 created_by = auth.uid()，但团队协作场景下
-- 非预设功能组应允许所有认证用户编辑/删除
-- ============================================

-- function_groups: 放宽更新策略
DROP POLICY IF EXISTS "用户可以更新自己创建的功能组" ON function_groups;
CREATE POLICY "认证用户可以更新非预设功能组" ON function_groups
  FOR UPDATE USING (auth.uid() IS NOT NULL AND is_preset = FALSE);

-- function_groups: 放宽删除策略
DROP POLICY IF EXISTS "用户可以删除自己创建的功能组" ON function_groups;
CREATE POLICY "认证用户可以删除非预设功能组" ON function_groups
  FOR DELETE USING (auth.uid() IS NOT NULL AND is_preset = FALSE);

-- function_group_items: 放宽写入策略
DROP POLICY IF EXISTS "用户可以添加自己功能组的内容" ON function_group_items;
CREATE POLICY "认证用户可以添加非预设功能组的内容" ON function_group_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM function_groups
      WHERE function_groups.id = group_id
      AND is_preset = FALSE
      AND auth.uid() IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "用户可以更新自己功能组的内容排序" ON function_group_items;
CREATE POLICY "认证用户可以更新非预设功能组的内容" ON function_group_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM function_groups
      WHERE function_groups.id = group_id
      AND is_preset = FALSE
      AND auth.uid() IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "用户可以删除自己功能组的内容" ON function_group_items;
CREATE POLICY "认证用户可以删除非预设功能组的内容" ON function_group_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM function_groups
      WHERE function_groups.id = group_id
      AND is_preset = FALSE
      AND auth.uid() IS NOT NULL
    )
  );
