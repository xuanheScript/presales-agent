-- 将 AI 澄清结果保存为 append-only 需求来源，并允许非会议来源显式生成后续正式需求版本。

ALTER TABLE public.elicitation_sessions
  ADD COLUMN input_requirement_baseline_id UUID;

ALTER TABLE public.elicitation_sessions
  ADD CONSTRAINT elicitation_sessions_input_baseline_fk
  FOREIGN KEY (input_requirement_baseline_id, project_id)
  REFERENCES public.requirement_baselines(id, project_id)
  ON DELETE RESTRICT;

CREATE UNIQUE INDEX uq_requirements_elicitation_session
  ON public.requirements(elicitation_session_id)
  WHERE elicitation_session_id IS NOT NULL;

-- 历史版本可能曾把同一需求来源写入多个 meeting baseline；只约束新的非会议子版本。
CREATE UNIQUE INDEX uq_requirement_baselines_source_requirement
  ON public.requirement_baselines(project_id, source_requirement_id)
  WHERE applied_change_set_id IS NULL
    AND parent_baseline_id IS NOT NULL;

-- 初始版本和后续非会议来源版本均由 source_requirement_id 标识。
ALTER TABLE public.requirement_baselines
  DROP CONSTRAINT requirement_baselines_source_check,
  ADD CONSTRAINT requirement_baselines_source_check CHECK (
    (applied_change_set_id IS NULL
      AND source_requirement_id IS NOT NULL
      AND source_meeting_id IS NULL
      AND source_transcript_revision_id IS NULL
      AND source_analysis_version_id IS NULL)
    OR applied_change_set_id IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.validate_requirement_baseline_lineage()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.revision_no = 1 AND NEW.parent_baseline_id IS NOT NULL THEN
    RAISE EXCEPTION '首个正式需求版本不能包含父版本' USING ERRCODE = '23514';
  END IF;
  IF NEW.revision_no > 1 AND NEW.parent_baseline_id IS NULL THEN
    RAISE EXCEPTION '后续正式需求版本必须包含父版本' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_baseline_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.requirement_baselines parent
     WHERE parent.id = NEW.parent_baseline_id
       AND parent.project_id = NEW.project_id
       AND parent.revision_no = NEW.revision_no - 1
  ) THEN
    RAISE EXCEPTION '正式需求父版本必须是同项目的前一版本' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_requirement_source_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- 项目级联删除时允许清理来源记录。
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.requirement_baselines rb
     WHERE rb.source_requirement_id = OLD.id
  ) OR (
    OLD.elicitation_session_id IS NOT NULL
    AND EXISTS (
      SELECT 1
        FROM public.elicitation_sessions es
       WHERE es.id = OLD.elicitation_session_id
         AND es.status = 'completed'
    )
  ) THEN
    RAISE EXCEPTION '已确认的需求来源不可修改或删除' USING ERRCODE = '55000';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_completed_elicitation_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'completed'
     AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id) THEN
    RAISE EXCEPTION '已完成的需求澄清会话不可修改或删除' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_completed_elicitation_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_session_id UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.session_id ELSE NEW.session_id END;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.elicitation_sessions es
     WHERE es.id = v_session_id
       AND es.status = 'completed'
  ) THEN
    RAISE EXCEPTION '已完成需求澄清的问答证据不可修改' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER validate_requirement_baseline_lineage
BEFORE INSERT ON public.requirement_baselines
FOR EACH ROW EXECUTE FUNCTION public.validate_requirement_baseline_lineage();

CREATE TRIGGER protect_requirement_source_record
BEFORE UPDATE OR DELETE ON public.requirements
FOR EACH ROW EXECUTE FUNCTION public.protect_requirement_source_record();

CREATE TRIGGER protect_completed_elicitation_session
BEFORE UPDATE OR DELETE ON public.elicitation_sessions
FOR EACH ROW EXECUTE FUNCTION public.protect_completed_elicitation_session();

CREATE TRIGGER protect_completed_elicitation_message
BEFORE INSERT OR UPDATE OR DELETE ON public.elicitation_messages
FOR EACH ROW EXECUTE FUNCTION public.protect_completed_elicitation_message();

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
  v_existing_requirement public.requirements%ROWTYPE;
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

  SELECT r.* INTO v_existing_requirement
    FROM public.requirements r
   WHERE r.elicitation_session_id = p_session_id;

  -- 已完成会话必须幂等返回，不能再次改写结果或审计时间。
  IF v_session.status = 'completed' THEN
    IF v_existing_requirement.id IS NULL THEN
      RAISE EXCEPTION '已完成引导会话缺少结果来源' USING ERRCODE = '23503';
    END IF;
    RETURN v_session;
  END IF;

  IF p_raw_content IS NULL
     OR char_length(pg_catalog.btrim(p_raw_content)) NOT BETWEEN 1 AND 2000000
     OR p_parsed_content IS NULL
     OR pg_catalog.jsonb_typeof(p_parsed_content) <> 'object' THEN
    RAISE EXCEPTION '澄清结果内容无效' USING ERRCODE = '22023';
  END IF;

  -- 保留旧参数以兼容已部署调用方，但只校验项目归属，绝不更新原需求。
  IF p_requirement_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.requirements r
     WHERE r.id = p_requirement_id
       AND r.project_id = v_session.project_id
  ) THEN
    RAISE EXCEPTION '引导会话关联的初始需求不存在' USING ERRCODE = '23503';
  END IF;

  -- active 会话仍可能被数据库管理员错误写入结果；在完成前只允许本事务创建。
  IF v_existing_requirement.id IS NOT NULL THEN
    RAISE EXCEPTION '引导会话已有未确认的结果来源' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.requirements (
    project_id,
    raw_content,
    parsed_content,
    file_url,
    requirement_type,
    source,
    elicitation_session_id
  ) VALUES (
    v_session.project_id,
    pg_catalog.btrim(p_raw_content),
    p_parsed_content,
    NULL,
    'text',
    'elicitation',
    p_session_id
  );

  UPDATE public.elicitation_sessions es
     SET status = 'completed',
         completed_at = NOW(),
         completion_summary = p_completion_summary,
         updated_at = NOW()
   WHERE es.id = p_session_id
  RETURNING es.* INTO v_session;

  RETURN v_session;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_requirement_source(
  p_project_id UUID,
  p_requirement_id UUID,
  p_expected_baseline_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_requirement public.requirements%ROWTYPE;
  v_base public.requirement_baselines%ROWTYPE;
  v_existing_baseline_id UUID;
  v_baseline_id UUID;
  v_revision_no INTEGER;
  v_sections JSONB;
  v_entry JSONB;
  v_snapshot JSONB;
  v_canonical_content TEXT;
  v_content_hash TEXT;
BEGIN
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION '仅登录用户可以确认需求来源' USING ERRCODE = '42501';
  END IF;

  SELECT p.* INTO v_project
    FROM public.projects p
   WHERE p.id = p_project_id
     AND p.created_by = auth.uid()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '项目不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;
  IF v_project.status = 'archived' THEN
    RAISE EXCEPTION '归档项目不能更新正式需求' USING ERRCODE = 'P0001';
  END IF;

  SELECT r.* INTO v_requirement
    FROM public.requirements r
   WHERE r.id = p_requirement_id
     AND r.project_id = p_project_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '需求来源不存在或不属于该项目' USING ERRCODE = '23503';
  END IF;
  IF v_requirement.source = 'elicitation' AND NOT EXISTS (
    SELECT 1
      FROM public.elicitation_sessions es
     WHERE es.id = v_requirement.elicitation_session_id
       AND es.project_id = p_project_id
       AND es.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'AI 澄清尚未完成，不能更新正式需求' USING ERRCODE = '55000';
  END IF;

  v_canonical_content := NULLIF(pg_catalog.btrim(v_requirement.raw_content), '');
  IF v_canonical_content IS NULL THEN
    RAISE EXCEPTION '需求来源内容为空，不能确认' USING ERRCODE = '22023';
  END IF;

  SELECT rb.id INTO v_existing_baseline_id
    FROM public.requirement_baselines rb
   WHERE rb.project_id = p_project_id
     AND rb.source_requirement_id = p_requirement_id
     AND rb.applied_change_set_id IS NULL
   ORDER BY rb.revision_no DESC
   LIMIT 1;
  IF FOUND THEN
    -- 该来源已经生成过正式版本；若它仍在当前版本祖先链中则幂等返回。
    IF v_project.current_requirement_baseline_id = v_existing_baseline_id
       OR EXISTS (
         WITH RECURSIVE ancestors AS (
           SELECT rb.id, rb.parent_baseline_id
             FROM public.requirement_baselines rb
            WHERE rb.id = v_project.current_requirement_baseline_id
              AND rb.project_id = p_project_id
           UNION ALL
           SELECT parent.id, parent.parent_baseline_id
             FROM public.requirement_baselines parent
             JOIN ancestors child ON child.parent_baseline_id = parent.id
            WHERE parent.project_id = p_project_id
         )
         SELECT 1 FROM ancestors WHERE id = v_existing_baseline_id
       ) THEN
      RETURN v_project.current_requirement_baseline_id;
    END IF;
    RAISE EXCEPTION '该需求来源属于另一条正式版本分支，不能重复应用' USING ERRCODE = '40001';
  END IF;

  IF v_project.current_requirement_baseline_id IS DISTINCT FROM p_expected_baseline_id THEN
    RAISE EXCEPTION '项目正式需求已更新，请刷新后重新确认' USING ERRCODE = '40001';
  END IF;

  IF v_project.current_requirement_baseline_id IS NULL THEN
    RETURN public.publish_initial_requirement_baseline(p_project_id, p_requirement_id);
  END IF;

  SELECT rb.* INTO v_base
    FROM public.requirement_baselines rb
   WHERE rb.id = v_project.current_requirement_baseline_id
     AND rb.project_id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '项目当前正式需求不存在' USING ERRCODE = '23503';
  END IF;

  v_sections := v_base.snapshot->'sections';
  IF pg_catalog.jsonb_typeof(v_sections->'requirements') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '项目当前正式需求快照无效' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_each(v_sections) section_data,
           LATERAL pg_catalog.jsonb_array_elements(section_data.value) entry
     WHERE entry->>'sourceRequirementId' = p_requirement_id::TEXT
  ) THEN
    RETURN v_base.id;
  END IF;

  v_entry := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'id', 'source-requirement-' || v_requirement.id::TEXT,
    'title', CASE
      WHEN v_requirement.source = 'elicitation' THEN 'AI 澄清后的需求'
      WHEN v_requirement.requirement_type = 'document' THEN '需求文档'
      ELSE '补充需求文本'
    END,
    'content', v_canonical_content,
    'kind', 'source',
    'sourceRequirementId', v_requirement.id,
    'elicitationSessionId', v_requirement.elicitation_session_id
  ));
  v_sections := pg_catalog.jsonb_set(
    v_sections,
    ARRAY['requirements'],
    v_sections->'requirements' || pg_catalog.jsonb_build_array(v_entry),
    false
  );
  v_snapshot := pg_catalog.jsonb_set(v_base.snapshot, ARRAY['sections'], v_sections, false);

  IF NOT public.is_requirement_baseline_snapshot_v1(v_snapshot) THEN
    RAISE EXCEPTION '生成的正式需求快照无效' USING ERRCODE = '23514';
  END IF;

  v_canonical_content := public.render_requirement_baseline_sections(v_sections);
  v_content_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_canonical_content, 'UTF8'), 'sha256'),
    'hex'
  );
  SELECT COALESCE(MAX(rb.revision_no), 0) + 1 INTO v_revision_no
    FROM public.requirement_baselines rb
   WHERE rb.project_id = p_project_id;

  INSERT INTO public.requirement_baselines (
    project_id,
    revision_no,
    parent_baseline_id,
    source_requirement_id,
    source_meeting_id,
    source_transcript_revision_id,
    source_analysis_version_id,
    applied_change_set_id,
    canonical_content,
    content_hash,
    snapshot,
    project_description_snapshot,
    created_by
  ) VALUES (
    p_project_id,
    v_revision_no,
    v_base.id,
    v_requirement.id,
    NULL,
    NULL,
    NULL,
    NULL,
    v_canonical_content,
    v_content_hash,
    v_snapshot,
    v_base.project_description_snapshot,
    auth.uid()
  ) RETURNING id INTO v_baseline_id;

  PERFORM pg_catalog.set_config('presales.allow_requirement_baseline_pointer_update', 'on', true);
  UPDATE public.projects
     SET current_requirement_baseline_id = v_baseline_id,
         updated_at = NOW()
   WHERE id = p_project_id;

  RETURN v_baseline_id;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_requirement_baseline_lineage() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_requirement_source_record() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_completed_elicitation_session() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_completed_elicitation_message() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_elicitation_session(UUID, UUID, JSONB, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_requirement_source(UUID, UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_elicitation_session(UUID, UUID, JSONB, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_requirement_source(UUID, UUID, UUID)
  TO authenticated;
