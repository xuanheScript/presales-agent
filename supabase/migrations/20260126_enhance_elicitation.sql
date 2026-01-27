-- 增强 Elicitation 功能的增量迁移

-- 1. 修改 current_round 默认值为 0（表示还未开始）
ALTER TABLE elicitation_sessions
ALTER COLUMN current_round SET DEFAULT 0;

-- 2. 为 requirements 表添加 source 字段，标识需求来源
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'requirements' AND column_name = 'source'
  ) THEN
    ALTER TABLE requirements
    ADD COLUMN source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'upload', 'elicitation'));
  END IF;
END $$;

-- 3. 为 requirements 表添加 elicitation_session_id 字段，关联澄清会话
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'requirements' AND column_name = 'elicitation_session_id'
  ) THEN
    ALTER TABLE requirements
    ADD COLUMN elicitation_session_id UUID REFERENCES elicitation_sessions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. 为 elicitation_messages 添加 extracted_info 字段，存储本轮提取的信息增量
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'elicitation_messages' AND column_name = 'extracted_info'
  ) THEN
    ALTER TABLE elicitation_messages
    ADD COLUMN extracted_info JSONB;
  END IF;
END $$;

-- 5. 创建 requirements.elicitation_session_id 索引
CREATE INDEX IF NOT EXISTS idx_requirements_elicitation_session_id
ON requirements(elicitation_session_id)
WHERE elicitation_session_id IS NOT NULL;
