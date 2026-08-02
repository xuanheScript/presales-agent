-- 统一 Elicitation 完成职责与轮次推进

CREATE OR REPLACE FUNCTION public.advance_elicitation_round(
  p_session_id UUID
) RETURNS TABLE (
  session_id UUID,
  current_round INTEGER,
  max_rounds INTEGER,
  reached_max_rounds BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.elicitation_sessions es
     SET current_round = LEAST(es.current_round + 1, es.max_rounds),
         updated_at = NOW()
    FROM public.projects p
   WHERE es.id = p_session_id
     AND es.project_id = p.id
     AND p.created_by = auth.uid()
     AND es.status = 'active'
  RETURNING
    es.id,
    es.current_round,
    es.max_rounds,
    es.current_round >= es.max_rounds;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_elicitation_session(
  p_session_id UUID,
  p_requirement_id UUID,
  p_parsed_content JSONB,
  p_raw_content TEXT,
  p_completion_summary TEXT DEFAULT NULL
) RETURNS public.elicitation_sessions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_session public.elicitation_sessions%ROWTYPE;
BEGIN
  SELECT es.*
    INTO v_session
    FROM public.elicitation_sessions es
    JOIN public.projects p ON p.id = es.project_id
   WHERE es.id = p_session_id
     AND p.created_by = auth.uid()
   FOR UPDATE OF es;

  IF NOT FOUND THEN
    RAISE EXCEPTION '引导会话不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;

  IF v_session.status = 'cancelled' THEN
    RAISE EXCEPTION '已取消的引导会话不能完成' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.requirements r
     SET parsed_content = p_parsed_content,
         raw_content = p_raw_content,
         source = 'elicitation',
         elicitation_session_id = p_session_id
   WHERE r.id = p_requirement_id
     AND r.project_id = v_session.project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '引导会话关联的需求不存在' USING ERRCODE = '23503';
  END IF;

  UPDATE public.elicitation_sessions es
     SET status = 'completed',
         completed_at = COALESCE(es.completed_at, NOW()),
         completion_summary = COALESCE(p_completion_summary, es.completion_summary),
         updated_at = NOW()
   WHERE es.id = p_session_id
  RETURNING es.* INTO v_session;

  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_elicitation_round(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_elicitation_session(UUID, UUID, JSONB, TEXT, TEXT) FROM PUBLIC;
-- Supabase 默认权限可能直接授予 anon；仅撤销 PUBLIC 不会移除该显式授权。
REVOKE ALL ON FUNCTION public.advance_elicitation_round(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_elicitation_session(UUID, UUID, JSONB, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.advance_elicitation_round(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_elicitation_session(UUID, UUID, JSONB, TEXT, TEXT) TO authenticated;
