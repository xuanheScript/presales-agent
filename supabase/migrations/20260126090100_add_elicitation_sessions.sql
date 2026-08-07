-- Elicitation 会话功能：存储需求澄清的结构化问答过程

-- elicitation_sessions 表
CREATE TABLE IF NOT EXISTS elicitation_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- 会话状态
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),

  -- 轮次控制
  current_round INTEGER NOT NULL DEFAULT 1,
  max_rounds INTEGER NOT NULL DEFAULT 8,

  -- 收集到的需求信息（结构化存储）
  collected_info JSONB DEFAULT '{}',

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- elicitation_messages 表（每轮问答记录）
CREATE TABLE IF NOT EXISTS elicitation_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES elicitation_sessions(id) ON DELETE CASCADE,

  -- 轮次和角色
  round INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('assistant', 'user')),

  -- 内容
  content TEXT NOT NULL,

  -- 如果是 assistant 的提问，存储问题结构
  questions JSONB,  -- [{question: "...", category: "scope|tech|timeline|..."}]

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_elicitation_sessions_project_id ON elicitation_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_elicitation_sessions_status ON elicitation_sessions(status);
CREATE INDEX IF NOT EXISTS idx_elicitation_messages_session_id ON elicitation_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_elicitation_messages_round ON elicitation_messages(round);

-- 创建更新时间触发器
CREATE TRIGGER update_elicitation_sessions_updated_at BEFORE UPDATE ON elicitation_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 启用 RLS
ALTER TABLE elicitation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE elicitation_messages ENABLE ROW LEVEL SECURITY;

-- elicitation_sessions RLS 策略
CREATE POLICY "用户可以查看自己项目的 elicitation 会话" ON elicitation_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = elicitation_sessions.project_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以为自己的项目创建 elicitation 会话" ON elicitation_sessions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = elicitation_sessions.project_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以更新自己项目的 elicitation 会话" ON elicitation_sessions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = elicitation_sessions.project_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以删除自己项目的 elicitation 会话" ON elicitation_sessions
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = elicitation_sessions.project_id
      AND projects.created_by = auth.uid()
    )
  );

-- elicitation_messages RLS 策略
CREATE POLICY "用户可以查看自己会话的 elicitation 消息" ON elicitation_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM elicitation_sessions
      JOIN projects ON projects.id = elicitation_sessions.project_id
      WHERE elicitation_sessions.id = elicitation_messages.session_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以为自己的会话添加 elicitation 消息" ON elicitation_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM elicitation_sessions
      JOIN projects ON projects.id = elicitation_sessions.project_id
      WHERE elicitation_sessions.id = elicitation_messages.session_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以更新自己会话的 elicitation 消息" ON elicitation_messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM elicitation_sessions
      JOIN projects ON projects.id = elicitation_sessions.project_id
      WHERE elicitation_sessions.id = elicitation_messages.session_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以删除自己会话的 elicitation 消息" ON elicitation_messages
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM elicitation_sessions
      JOIN projects ON projects.id = elicitation_sessions.project_id
      WHERE elicitation_sessions.id = elicitation_messages.session_id
      AND projects.created_by = auth.uid()
    )
  );
