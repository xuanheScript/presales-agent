-- 售前成本估算系统数据库 Schema
-- 使用 Supabase (PostgreSQL)

-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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
  estimated_hours DECIMAL(10, 2) NOT NULL DEFAULT 0,
  dependencies TEXT[],
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
  breakdown JSONB NOT NULL DEFAULT '{}',
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
CREATE INDEX IF NOT EXISTS idx_cost_estimates_project_id ON cost_estimates(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_project_id ON agent_executions(project_id);
