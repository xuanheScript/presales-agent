-- 迁移脚本：支持动态角色工时评估
-- 版本：20260129
-- 描述：
--   1. 更新 function_modules 表，添加 role_estimates JSONB 字段
--   2. 新增 project_roles 表存储识别的项目角色
--   3. 新增 additional_work_items 表存储额外工作项
--   4. 更新 cost_estimates 表结构

-- ============================================
-- 1. 更新 function_modules 表
-- ============================================

-- 添加 role_estimates 字段（JSONB 存储各角色工时）
ALTER TABLE function_modules
ADD COLUMN IF NOT EXISTS role_estimates JSONB DEFAULT '[]';

-- 添加注释
COMMENT ON COLUMN function_modules.role_estimates IS '各角色工时评估，格式: [{role: string, days: number, reason?: string}]';

-- 保留 estimated_hours 字段用于兼容（存储所有角色工时之和，单位：小时）
-- 旧数据仍然可以使用 estimated_hours
-- 新数据会同时填充 estimated_hours（汇总）和 role_estimates（明细）

-- ============================================
-- 2. 新增 project_roles 表
-- ============================================

CREATE TABLE IF NOT EXISTS project_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role_name TEXT NOT NULL,
  responsibility TEXT,
  headcount INTEGER NOT NULL DEFAULT 1,
  total_days DECIMAL(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_project_roles_project_id ON project_roles(project_id);

-- 添加注释
COMMENT ON TABLE project_roles IS '项目识别的角色列表及汇总信息';
COMMENT ON COLUMN project_roles.role_name IS '角色名称，如：后端开发、前端开发、嵌入式工程师';
COMMENT ON COLUMN project_roles.responsibility IS '角色职责描述';
COMMENT ON COLUMN project_roles.headcount IS '建议人数';
COMMENT ON COLUMN project_roles.total_days IS '该角色总工时（人天）';

-- 启用 RLS
ALTER TABLE project_roles ENABLE ROW LEVEL SECURITY;

-- RLS 策略
CREATE POLICY "用户可以查看自己项目的角色" ON project_roles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_roles.project_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以为自己的项目添加角色" ON project_roles
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_roles.project_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以删除自己项目的角色" ON project_roles
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_roles.project_id
      AND projects.created_by = auth.uid()
    )
  );

-- ============================================
-- 3. 新增 additional_work_items 表
-- ============================================

CREATE TABLE IF NOT EXISTS additional_work_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_item TEXT NOT NULL,
  days DECIMAL(10, 2) NOT NULL DEFAULT 0,
  assigned_roles TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_additional_work_items_project_id ON additional_work_items(project_id);

-- 添加注释
COMMENT ON TABLE additional_work_items IS '额外工作项（非功能开发工作）';
COMMENT ON COLUMN additional_work_items.work_item IS '工作项名称，如：技术架构设计、联调测试';
COMMENT ON COLUMN additional_work_items.days IS '工时（人天）';
COMMENT ON COLUMN additional_work_items.assigned_roles IS '承担该工作的角色列表';

-- 启用 RLS
ALTER TABLE additional_work_items ENABLE ROW LEVEL SECURITY;

-- RLS 策略
CREATE POLICY "用户可以查看自己项目的额外工作" ON additional_work_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = additional_work_items.project_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以为自己的项目添加额外工作" ON additional_work_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = additional_work_items.project_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以删除自己项目的额外工作" ON additional_work_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = additional_work_items.project_id
      AND projects.created_by = auth.uid()
    )
  );

-- ============================================
-- 4. 更新 cost_estimates 表
-- ============================================

-- 添加新字段
ALTER TABLE cost_estimates
ADD COLUMN IF NOT EXISTS base_days DECIMAL(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS buffered_days DECIMAL(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS buffer_coefficient DECIMAL(5, 3) DEFAULT 1.0;

-- 添加注释
COMMENT ON COLUMN cost_estimates.base_days IS '基础总人天（功能模块 + 额外工作）';
COMMENT ON COLUMN cost_estimates.buffered_days IS '含缓冲的总人天';
COMMENT ON COLUMN cost_estimates.buffer_coefficient IS '缓冲系数（1.2-2.0）';

-- 更新 breakdown 字段的注释（新格式）
COMMENT ON COLUMN cost_estimates.breakdown IS '成本明细，新格式包含: role_breakdown, additional_work_breakdown, third_party_services';

-- ============================================
-- 5. 数据迁移（可选）
-- ============================================

-- 为现有数据创建默认的 role_estimates（如果 estimated_hours > 0）
-- 这是一个安全的迁移，不会影响现有数据
UPDATE function_modules
SET role_estimates = jsonb_build_array(
  jsonb_build_object(
    'role', '开发',
    'days', ROUND(estimated_hours / 8, 1),
    'reason', '从旧数据迁移'
  )
)
WHERE role_estimates = '[]'
AND estimated_hours > 0;

-- ============================================
-- 6. 创建视图（可选，方便查询）
-- ============================================

-- 项目工时汇总视图
CREATE OR REPLACE VIEW project_effort_summary AS
SELECT
  p.id AS project_id,
  p.name AS project_name,
  COALESCE(SUM(pr.total_days), 0) AS role_total_days,
  COALESCE((
    SELECT SUM(aw.days)
    FROM additional_work_items aw
    WHERE aw.project_id = p.id
  ), 0) AS additional_total_days,
  COALESCE(ce.base_days, 0) AS base_days,
  COALESCE(ce.buffered_days, 0) AS buffered_days,
  COALESCE(ce.buffer_coefficient, 1.0) AS buffer_coefficient,
  COALESCE(ce.total_cost, 0) AS total_cost
FROM projects p
LEFT JOIN project_roles pr ON pr.project_id = p.id
LEFT JOIN cost_estimates ce ON ce.project_id = p.id
GROUP BY p.id, p.name, ce.base_days, ce.buffered_days, ce.buffer_coefficient, ce.total_cost;

-- 添加视图注释
COMMENT ON VIEW project_effort_summary IS '项目工时汇总视图，包含各角色工时、额外工作、缓冲系数等';
