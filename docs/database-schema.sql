-- 售前成本估算系统数据库 Schema
-- 使用 Supabase (PostgreSQL)

-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. 用户表（使用 Supabase Auth，这里只存扩展信息）
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'manager', 'user')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. 项目表
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  industry TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'analyzing', 'completed', 'archived')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);

-- 3. 需求表
CREATE TABLE IF NOT EXISTS requirements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  raw_content TEXT NOT NULL,
  parsed_content JSONB,
  file_url TEXT,
  requirement_type TEXT NOT NULL DEFAULT 'text' CHECK (requirement_type IN ('text', 'document', 'template')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. 功能模块表
CREATE TABLE IF NOT EXISTS function_modules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL,
  function_name TEXT NOT NULL,
  description TEXT,
  difficulty_level TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty_level IN ('simple', 'medium', 'complex', 'very_complex')),
  estimated_hours DECIMAL(10, 2) NOT NULL DEFAULT 0,  -- 总工时（小时），各角色工时之和
  role_estimates JSONB DEFAULT '[]',                   -- 各角色工时评估，格式: [{role, days, reason?}]
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,          -- 是否已验证为准确估算
  dependencies TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4.1 项目角色表（新增）
CREATE TABLE IF NOT EXISTS project_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role_name TEXT NOT NULL,                            -- 角色名称，如：后端开发、嵌入式工程师
  responsibility TEXT,                                 -- 角色职责描述
  headcount INTEGER NOT NULL DEFAULT 1,               -- 建议人数
  total_days DECIMAL(10, 2) NOT NULL DEFAULT 0,       -- 该角色总工时（人天）
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4.2 额外工作项表（新增）
CREATE TABLE IF NOT EXISTS additional_work_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_item TEXT NOT NULL,                            -- 工作项名称，如：技术架构设计、联调测试
  days DECIMAL(10, 2) NOT NULL DEFAULT 0,             -- 工时（人天）
  assigned_roles TEXT[] NOT NULL DEFAULT '{}',        -- 承担该工作的角色列表
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. 成本估算表
CREATE TABLE IF NOT EXISTS cost_estimates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  labor_cost DECIMAL(12, 2) NOT NULL DEFAULT 0,
  service_cost DECIMAL(12, 2) NOT NULL DEFAULT 0,
  infrastructure_cost DECIMAL(12, 2) NOT NULL DEFAULT 0,
  buffer_percentage DECIMAL(5, 2) NOT NULL DEFAULT 15,
  total_cost DECIMAL(12, 2) NOT NULL DEFAULT 0,
  -- 新增字段
  base_days DECIMAL(10, 2) DEFAULT 0,                 -- 基础总人天
  buffered_days DECIMAL(10, 2) DEFAULT 0,             -- 含缓冲的总人天
  buffer_coefficient DECIMAL(5, 3) DEFAULT 1.0,       -- 缓冲系数（1.2-2.0）
  -- breakdown 包含角色明细: {role_breakdown, additional_work_breakdown, third_party_services}
  breakdown JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. 模板表
CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_type TEXT NOT NULL CHECK (template_type IN ('requirement_analysis', 'function_breakdown', 'effort_estimation', 'cost_calculation')),
  template_name TEXT NOT NULL,
  prompt_content TEXT NOT NULL,
  industry TEXT,
  version TEXT NOT NULL DEFAULT '1.0',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. 功能库表
CREATE TABLE IF NOT EXISTS function_library (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  function_name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  standard_hours DECIMAL(10, 2) NOT NULL,
  complexity_factors JSONB,
  reference_cost DECIMAL(12, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7.1 估算参考库表（从已验证的功能模块提取，用于 AI 工时评估的 Few-shot 参考）
CREATE TABLE IF NOT EXISTS estimate_references (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  module_name TEXT NOT NULL,
  function_name TEXT NOT NULL,
  description TEXT,
  difficulty_level TEXT NOT NULL DEFAULT 'medium'
    CHECK (difficulty_level IN ('simple', 'medium', 'complex', 'very_complex')),
  role_estimates JSONB NOT NULL DEFAULT '[]',           -- 角色工时: [{role, days, reason?}]
  estimated_hours DECIMAL(10, 2) NOT NULL DEFAULT 0,    -- 总工时（小时）
  project_type TEXT,                                     -- 项目类型（用于检索匹配）
  category TEXT,                                         -- 功能分类
  industry TEXT,                                         -- 行业
  tech_stack TEXT[],                                     -- 技术栈标签
  source_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  source_function_module_id UUID,                        -- 来源功能模块 ID（无 FK 约束）
  usage_count INTEGER NOT NULL DEFAULT 0,                -- 被 AI 引用次数
  verified_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. 系统配置表
CREATE TABLE IF NOT EXISTS system_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  default_labor_cost_per_day DECIMAL(12, 2) NOT NULL DEFAULT 1500,
  default_risk_buffer_percentage DECIMAL(5, 2) NOT NULL DEFAULT 15,
  currency TEXT NOT NULL DEFAULT 'CNY',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);

-- 9. Agent 执行记录表（可选，用于追踪 Agent 运行历史）
CREATE TABLE IF NOT EXISTS agent_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL,
  input_data JSONB NOT NULL,
  output_data JSONB,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT,
  execution_time_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_requirements_project_id ON requirements(project_id);
CREATE INDEX IF NOT EXISTS idx_function_modules_project_id ON function_modules(project_id);
CREATE INDEX IF NOT EXISTS idx_project_roles_project_id ON project_roles(project_id);
CREATE INDEX IF NOT EXISTS idx_additional_work_items_project_id ON additional_work_items(project_id);
CREATE INDEX IF NOT EXISTS idx_cost_estimates_project_id ON cost_estimates(project_id);
CREATE INDEX IF NOT EXISTS idx_templates_type_active ON templates(template_type, is_active);
CREATE INDEX IF NOT EXISTS idx_function_library_category ON function_library(category);
CREATE INDEX IF NOT EXISTS idx_agent_executions_project_id ON agent_executions(project_id);

-- 创建更新时间触发器函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为需要更新时间戳的表添加触发器
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cost_estimates_updated_at BEFORE UPDATE ON cost_estimates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_function_library_updated_at BEFORE UPDATE ON function_library
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_system_config_updated_at BEFORE UPDATE ON system_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) 策略
-- 启用 RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE function_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE additional_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE function_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_executions ENABLE ROW LEVEL SECURITY;

-- Profiles 策略
CREATE POLICY "用户可以查看自己的 profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "用户可以更新自己的 profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Projects 策略
CREATE POLICY "用户可以查看自己创建的项目" ON projects
  FOR SELECT USING (auth.uid() = created_by);

CREATE POLICY "用户可以创建项目" ON projects
  FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "用户可以更新自己的项目" ON projects
  FOR UPDATE USING (auth.uid() = created_by);

CREATE POLICY "用户可以删除自己的项目" ON projects
  FOR DELETE USING (auth.uid() = created_by);

-- Requirements 策略
CREATE POLICY "用户可以查看自己项目的需求" ON requirements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = requirements.project_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以为自己的项目添加需求" ON requirements
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = requirements.project_id
      AND projects.created_by = auth.uid()
    )
  );

-- Function Modules 策略
CREATE POLICY "用户可以查看自己项目的功能" ON function_modules
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = function_modules.project_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以为自己的项目添加功能" ON function_modules
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = function_modules.project_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以删除自己项目的功能" ON function_modules
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = function_modules.project_id
      AND projects.created_by = auth.uid()
    )
  );

-- Project Roles 策略
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

-- Additional Work Items 策略
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

-- Cost Estimates 策略
CREATE POLICY "用户可以查看自己项目的成本估算" ON cost_estimates
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = cost_estimates.project_id
      AND projects.created_by = auth.uid()
    )
  );

-- Templates 策略（所有认证用户可读，管理员可写）
CREATE POLICY "认证用户可以查看活跃模板" ON templates
  FOR SELECT USING (auth.uid() IS NOT NULL AND is_active = TRUE);

-- Function Library 策略（所有认证用户可读）
CREATE POLICY "认证用户可以查看功能库" ON function_library
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- System Config 策略（所有认证用户可读）
CREATE POLICY "认证用户可以查看系统配置" ON system_config
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Agent Executions 策略
CREATE POLICY "用户可以查看自己项目的 Agent 执行记录" ON agent_executions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = agent_executions.project_id
      AND projects.created_by = auth.uid()
    )
  );
