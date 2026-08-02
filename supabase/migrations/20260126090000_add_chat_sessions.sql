-- 聊天会话功能：存储项目下的聊天会话和消息历史

-- 聊天会话表
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT,  -- 会话标题，可从第一条消息自动生成
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 聊天消息表
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  parts JSONB NOT NULL,  -- 存储 UIMessage 的 parts 数组
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_chat_sessions_project_id ON chat_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);

-- 创建更新时间触发器
CREATE TRIGGER update_chat_sessions_updated_at BEFORE UPDATE ON chat_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 启用 RLS
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- chat_sessions RLS 策略
CREATE POLICY "用户可以查看自己项目的会话" ON chat_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = chat_sessions.project_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以为自己的项目创建会话" ON chat_sessions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = chat_sessions.project_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以更新自己项目的会话" ON chat_sessions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = chat_sessions.project_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以删除自己项目的会话" ON chat_sessions
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = chat_sessions.project_id
      AND projects.created_by = auth.uid()
    )
  );

-- chat_messages RLS 策略
CREATE POLICY "用户可以查看自己会话的消息" ON chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM chat_sessions
      JOIN projects ON projects.id = chat_sessions.project_id
      WHERE chat_sessions.id = chat_messages.session_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以为自己的会话添加消息" ON chat_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_sessions
      JOIN projects ON projects.id = chat_sessions.project_id
      WHERE chat_sessions.id = chat_messages.session_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以更新自己会话的消息" ON chat_messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM chat_sessions
      JOIN projects ON projects.id = chat_sessions.project_id
      WHERE chat_sessions.id = chat_messages.session_id
      AND projects.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以删除自己会话的消息" ON chat_messages
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM chat_sessions
      JOIN projects ON projects.id = chat_sessions.project_id
      WHERE chat_sessions.id = chat_messages.session_id
      AND projects.created_by = auth.uid()
    )
  );
