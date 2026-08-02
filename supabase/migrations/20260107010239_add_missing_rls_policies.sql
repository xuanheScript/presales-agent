-- =====================================================
-- 补充缺失的 RLS 策略
-- =====================================================

-- Requirements 表 - UPDATE 和 DELETE 策略
CREATE POLICY "users_can_update_own_project_requirements" ON requirements
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = requirements.project_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "users_can_delete_own_project_requirements" ON requirements
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = requirements.project_id
      AND projects.created_by = auth.uid()
    )
  );

-- Function Modules 表 - INSERT、UPDATE、DELETE 策略
CREATE POLICY "users_can_insert_own_project_functions" ON function_modules
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = function_modules.project_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "users_can_update_own_project_functions" ON function_modules
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = function_modules.project_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "users_can_delete_own_project_functions" ON function_modules
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = function_modules.project_id
      AND projects.created_by = auth.uid()
    )
  );

-- Cost Estimates 表 - INSERT、UPDATE、DELETE 策略
CREATE POLICY "users_can_insert_own_project_cost_estimates" ON cost_estimates
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = cost_estimates.project_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "users_can_update_own_project_cost_estimates" ON cost_estimates
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = cost_estimates.project_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "users_can_delete_own_project_cost_estimates" ON cost_estimates
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = cost_estimates.project_id
      AND projects.created_by = auth.uid()
    )
  );
