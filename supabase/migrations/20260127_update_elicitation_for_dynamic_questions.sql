-- 更新 elicitation_sessions 表以支持动态问题生成

-- 添加 current_questions 字段（存储当前待回答的问题）
ALTER TABLE elicitation_sessions
ADD COLUMN IF NOT EXISTS current_questions JSONB DEFAULT '[]';

-- 添加 completion_summary 字段（AI 完成引导时的总结）
ALTER TABLE elicitation_sessions
ADD COLUMN IF NOT EXISTS completion_summary TEXT;

-- 添加注释
COMMENT ON COLUMN elicitation_sessions.current_questions IS '当前待回答的结构化问题列表';
COMMENT ON COLUMN elicitation_sessions.completion_summary IS 'AI 完成引导时对收集信息的总结';
