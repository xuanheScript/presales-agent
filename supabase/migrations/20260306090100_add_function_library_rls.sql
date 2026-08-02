-- 为 function_library 表添加缺失的 INSERT/UPDATE/DELETE RLS 策略
-- 所有认证用户都可以管理功能库（功能库是共享资源）

CREATE POLICY "认证用户可以创建功能库项目" ON function_library
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "认证用户可以更新功能库项目" ON function_library
  FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "认证用户可以删除功能库项目" ON function_library
  FOR DELETE USING (auth.uid() IS NOT NULL);
