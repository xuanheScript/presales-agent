-- 会议需求变更集审核与不可变项目需求基线

CREATE OR REPLACE FUNCTION public.is_requirement_baseline_snapshot_v1(p_snapshot JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT COALESCE(
    p_snapshot IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_snapshot) = 'object'
    AND p_snapshot->>'schemaVersion' = 'requirement-baseline-v1'
    AND pg_catalog.jsonb_typeof(p_snapshot->'projectDescription') = 'string'
    AND (
      p_snapshot->'sourceRequirement' = 'null'::jsonb
      OR pg_catalog.jsonb_typeof(p_snapshot->'sourceRequirement') = 'object'
    )
    AND pg_catalog.jsonb_typeof(p_snapshot->'sections') = 'object'
    AND pg_catalog.jsonb_typeof(p_snapshot->'sections'->'requirements') = 'array'
    AND pg_catalog.jsonb_typeof(p_snapshot->'sections'->'business_goals') = 'array'
    AND pg_catalog.jsonb_typeof(p_snapshot->'sections'->'key_features') = 'array'
    AND pg_catalog.jsonb_typeof(p_snapshot->'sections'->'tech_stack') = 'array'
    AND pg_catalog.jsonb_typeof(p_snapshot->'sections'->'non_functional_requirements') = 'array'
    AND pg_catalog.jsonb_typeof(p_snapshot->'sections'->'risks') = 'array'
    AND pg_catalog.jsonb_typeof(p_snapshot->'sections'->'decisions') = 'array'
    AND pg_catalog.jsonb_typeof(p_snapshot->'sections'->'action_items') = 'array'
    AND pg_catalog.jsonb_typeof(p_snapshot->'sections'->'conflicts') = 'array'
    AND pg_catalog.jsonb_typeof(p_snapshot->'sections'->'open_questions') = 'array'
    AND pg_catalog.jsonb_typeof(p_snapshot->'sections'->'out_of_scope') = 'array'
    AND pg_catalog.jsonb_typeof(p_snapshot->'appliedChangeSets') = 'array',
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.render_requirement_baseline_sections(p_sections JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  v_section RECORD;
  v_entry JSONB;
  v_output TEXT := '# 项目需求基线';
BEGIN
  FOR v_section IN
    SELECT * FROM (VALUES
      (1, 'requirements', '需求正文'),
      (2, 'business_goals', '业务目标'),
      (3, 'key_features', '关键功能'),
      (4, 'tech_stack', '技术栈'),
      (5, 'non_functional_requirements', '非功能需求'),
      (6, 'risks', '风险'),
      (7, 'decisions', '决策'),
      (8, 'action_items', '行动项'),
      (9, 'conflicts', '冲突'),
      (10, 'open_questions', '未决问题'),
      (11, 'out_of_scope', '范围外事项')
    ) AS sections(sequence_no, section_key, label)
    ORDER BY sequence_no
  LOOP
    IF pg_catalog.jsonb_array_length(COALESCE(p_sections->v_section.section_key, '[]'::jsonb)) = 0 THEN
      CONTINUE;
    END IF;
    v_output := v_output || E'\n\n## ' || v_section.label;
    FOR v_entry IN
      SELECT value
        FROM pg_catalog.jsonb_array_elements(p_sections->v_section.section_key)
    LOOP
      IF pg_catalog.jsonb_typeof(v_entry) <> 'object'
         OR COALESCE(pg_catalog.btrim(v_entry->>'title'), '') = ''
         OR COALESCE(pg_catalog.btrim(v_entry->>'content'), '') = '' THEN
        RAISE EXCEPTION '需求基线区段条目无效' USING ERRCODE = '22023';
      END IF;
      v_output := v_output || E'\n\n### ' || pg_catalog.btrim(v_entry->>'title')
        || E'\n\n' || pg_catalog.btrim(v_entry->>'content');
    END LOOP;
  END LOOP;
  IF v_output = '# 项目需求基线' THEN
    RAISE EXCEPTION '需求基线不能为空' USING ERRCODE = '22023';
  END IF;
  RETURN v_output;
END;
$$;

ALTER TABLE public.projects
  ADD COLUMN current_requirement_baseline_id UUID;

ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_id_project_unique UNIQUE (id, project_id);
ALTER TABLE public.requirements
  ADD CONSTRAINT requirements_id_project_unique UNIQUE (id, project_id);
ALTER TABLE public.transcript_revisions
  ADD CONSTRAINT transcript_revisions_id_project_meeting_unique UNIQUE (id, project_id, meeting_id);
ALTER TABLE public.meeting_analysis_versions
  ADD CONSTRAINT meeting_analysis_versions_identity_unique
  UNIQUE (id, project_id, meeting_id, transcript_revision_id);
ALTER TABLE public.meeting_analysis_items
  ADD CONSTRAINT meeting_analysis_items_id_version_project_unique UNIQUE (id, analysis_version_id, project_id);

CREATE TABLE public.requirement_change_sets (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL,
  analysis_version_id UUID NOT NULL,
  transcript_revision_id UUID NOT NULL,
  base_baseline_id UUID,
  base_requirement_id UUID,
  base_canonical_content TEXT NOT NULL
    CHECK (char_length(btrim(base_canonical_content)) BETWEEN 1 AND 2000000),
  base_content_hash TEXT NOT NULL CHECK (base_content_hash ~ '^[0-9a-f]{64}$'),
  base_snapshot JSONB NOT NULL CHECK (public.is_requirement_baseline_snapshot_v1(base_snapshot)),
  base_project_description_snapshot TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'in_review'
    CHECK (status IN ('in_review', 'applied', 'superseded')),
  superseded_by_change_set_id UUID,
  resulting_baseline_id UUID,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  applied_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  applied_at TIMESTAMP WITH TIME ZONE,
  superseded_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (id, project_id),
  CHECK (
    (status = 'applied' AND resulting_baseline_id IS NOT NULL
      AND applied_by IS NOT NULL AND applied_at IS NOT NULL
      AND superseded_by_change_set_id IS NULL AND superseded_at IS NULL)
    OR (status = 'in_review' AND resulting_baseline_id IS NULL
      AND applied_by IS NULL AND applied_at IS NULL
      AND superseded_by_change_set_id IS NULL AND superseded_at IS NULL)
    OR (status = 'superseded' AND resulting_baseline_id IS NULL
      AND applied_by IS NULL AND applied_at IS NULL
      AND superseded_by_change_set_id IS NOT NULL AND superseded_at IS NOT NULL)
  ),
  CONSTRAINT requirement_change_sets_meeting_fk
    FOREIGN KEY (meeting_id, project_id)
    REFERENCES public.meetings(id, project_id) ON DELETE CASCADE,
  CONSTRAINT requirement_change_sets_analysis_fk
    FOREIGN KEY (analysis_version_id, project_id, meeting_id, transcript_revision_id)
    REFERENCES public.meeting_analysis_versions(
      id, project_id, meeting_id, transcript_revision_id
    ) ON DELETE RESTRICT,
  CONSTRAINT requirement_change_sets_transcript_fk
    FOREIGN KEY (transcript_revision_id, project_id, meeting_id)
    REFERENCES public.transcript_revisions(id, project_id, meeting_id) ON DELETE RESTRICT,
  CONSTRAINT requirement_change_sets_requirement_fk
    FOREIGN KEY (base_requirement_id, project_id)
    REFERENCES public.requirements(id, project_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_requirement_change_sets_active_analysis
  ON public.requirement_change_sets(analysis_version_id)
  WHERE status IN ('in_review', 'applied');

CREATE TABLE public.requirement_change_items (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  change_set_id UUID NOT NULL,
  source_analysis_version_id UUID NOT NULL,
  source_analysis_item_id UUID NOT NULL,
  target_entry_id TEXT,
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 0),
  category TEXT NOT NULL CHECK (category IN (
    'requirement', 'decision', 'action_item', 'risk', 'conflict',
    'open_question', 'out_of_scope'
  )),
  operation TEXT NOT NULL CHECK (operation IN ('add', 'replace', 'remove', 'note')),
  target_path TEXT NOT NULL CHECK (target_path IN (
    'requirements', 'business_goals', 'key_features', 'tech_stack',
    'non_functional_requirements', 'risks', 'decisions', 'action_items',
    'conflicts', 'open_questions', 'out_of_scope'
  )),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  content TEXT NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 4000),
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'accepted', 'excluded')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (change_set_id, source_analysis_item_id),
  UNIQUE (change_set_id, sequence_no),
  CONSTRAINT requirement_change_items_set_fk
    FOREIGN KEY (change_set_id, project_id)
    REFERENCES public.requirement_change_sets(id, project_id) ON DELETE CASCADE,
  CONSTRAINT requirement_change_items_source_fk
    FOREIGN KEY (source_analysis_item_id, source_analysis_version_id, project_id)
    REFERENCES public.meeting_analysis_items(id, analysis_version_id, project_id) ON DELETE RESTRICT
);

CREATE TABLE public.requirement_baselines (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL CHECK (revision_no > 0),
  parent_baseline_id UUID,
  source_requirement_id UUID,
  source_meeting_id UUID,
  source_transcript_revision_id UUID,
  source_analysis_version_id UUID,
  applied_change_set_id UUID NOT NULL,
  canonical_content TEXT NOT NULL CHECK (char_length(btrim(canonical_content)) BETWEEN 1 AND 2000000),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  snapshot JSONB NOT NULL CHECK (public.is_requirement_baseline_snapshot_v1(snapshot)),
  project_description_snapshot TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, revision_no),
  UNIQUE (id, project_id),
  UNIQUE (applied_change_set_id, project_id),
  CONSTRAINT requirement_baselines_parent_fk
    FOREIGN KEY (parent_baseline_id, project_id)
    REFERENCES public.requirement_baselines(id, project_id) ON DELETE RESTRICT,
  CONSTRAINT requirement_baselines_requirement_fk
    FOREIGN KEY (source_requirement_id, project_id)
    REFERENCES public.requirements(id, project_id) ON DELETE RESTRICT,
  CONSTRAINT requirement_baselines_meeting_fk
    FOREIGN KEY (source_meeting_id, project_id)
    REFERENCES public.meetings(id, project_id) ON DELETE RESTRICT,
  CONSTRAINT requirement_baselines_transcript_fk
    FOREIGN KEY (source_transcript_revision_id, project_id, source_meeting_id)
    REFERENCES public.transcript_revisions(id, project_id, meeting_id) ON DELETE RESTRICT,
  CONSTRAINT requirement_baselines_analysis_fk
    FOREIGN KEY (
      source_analysis_version_id, project_id, source_meeting_id,
      source_transcript_revision_id
    ) REFERENCES public.meeting_analysis_versions(
      id, project_id, meeting_id, transcript_revision_id
    ) ON DELETE RESTRICT,
  CONSTRAINT requirement_baselines_change_set_fk
    FOREIGN KEY (applied_change_set_id, project_id)
    REFERENCES public.requirement_change_sets(id, project_id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE public.requirement_change_sets
  ADD CONSTRAINT requirement_change_sets_base_baseline_fk
    FOREIGN KEY (base_baseline_id, project_id)
    REFERENCES public.requirement_baselines(id, project_id) ON DELETE RESTRICT,
  ADD CONSTRAINT requirement_change_sets_superseded_by_fk
    FOREIGN KEY (superseded_by_change_set_id, project_id)
    REFERENCES public.requirement_change_sets(id, project_id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT requirement_change_sets_resulting_baseline_fk
    FOREIGN KEY (resulting_baseline_id, project_id)
    REFERENCES public.requirement_baselines(id, project_id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_current_requirement_baseline_fk
  FOREIGN KEY (current_requirement_baseline_id, id)
  REFERENCES public.requirement_baselines(id, project_id) ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX idx_requirement_change_sets_project
  ON public.requirement_change_sets(project_id, created_at DESC);
CREATE INDEX idx_requirement_change_sets_meeting
  ON public.requirement_change_sets(meeting_id, created_at DESC);
CREATE INDEX idx_requirement_change_items_set
  ON public.requirement_change_items(change_set_id, sequence_no);
CREATE INDEX idx_requirement_baselines_project
  ON public.requirement_baselines(project_id, revision_no DESC);
CREATE INDEX idx_requirement_baselines_source_analysis
  ON public.requirement_baselines(source_analysis_version_id);

ALTER TABLE public.requirement_change_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requirement_change_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requirement_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户可以查看自己项目的需求变更集"
  ON public.requirement_change_sets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = requirement_change_sets.project_id
        AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以查看自己项目的需求变更项"
  ON public.requirement_change_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = requirement_change_items.project_id
        AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以查看自己项目的需求基线"
  ON public.requirement_baselines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = requirement_baselines.project_id
        AND p.created_by = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.protect_requirement_baseline()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '需求基线不可修改；请创建新的需求基线版本' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id) THEN
    RAISE EXCEPTION '需求基线不可删除' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_applied_requirement_change_set()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'applied' THEN
    IF TG_OP = 'DELETE' AND NOT EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id
    ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION '已应用的需求变更集不可修改或删除' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_applied_requirement_change_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.requirement_change_sets rcs
    WHERE rcs.id = OLD.change_set_id AND rcs.status = 'applied'
  ) THEN
    IF TG_OP = 'DELETE' AND NOT EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id
    ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION '已应用的需求变更项不可修改或删除' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_requirement_change_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.requirement_change_items rci
    WHERE rci.source_analysis_item_id = OLD.id
  ) THEN
    IF TG_OP = 'DELETE' OR NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION '已用于需求变更集的会议洞察项不可修改或删除' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_approved_meeting_analysis_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    IF TG_OP = 'DELETE' AND NOT EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id
    ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION '已批准的会议分析版本不可修改或删除' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_approved_meeting_analysis_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_old_item_id UUID := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.analysis_item_id END;
  v_new_item_id UUID := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.analysis_item_id END;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.meeting_analysis_items mai
      JOIN public.meeting_analysis_versions mav ON mav.id = mai.analysis_version_id
     WHERE mai.id IN (v_old_item_id, v_new_item_id)
       AND mav.status = 'approved'
  ) THEN
    RAISE EXCEPTION '已批准的会议分析证据不可修改' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_project_requirement_baseline_pointer()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.current_requirement_baseline_id IS DISTINCT FROM OLD.current_requirement_baseline_id
     AND pg_catalog.current_setting('presales.allow_requirement_baseline_pointer_update', true)
       IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '项目当前需求基线只能通过受控应用事务更新' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_project_requirement_baseline_pointer
BEFORE UPDATE OF current_requirement_baseline_id ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.protect_project_requirement_baseline_pointer();

CREATE TRIGGER protect_requirement_baseline
BEFORE UPDATE OR DELETE ON public.requirement_baselines
FOR EACH ROW EXECUTE FUNCTION public.protect_requirement_baseline();

CREATE TRIGGER protect_applied_requirement_change_set
BEFORE UPDATE OR DELETE ON public.requirement_change_sets
FOR EACH ROW EXECUTE FUNCTION public.protect_applied_requirement_change_set();

CREATE TRIGGER protect_applied_requirement_change_item
BEFORE UPDATE OR DELETE ON public.requirement_change_items
FOR EACH ROW EXECUTE FUNCTION public.protect_applied_requirement_change_item();

CREATE TRIGGER protect_requirement_change_source
BEFORE UPDATE OR DELETE ON public.meeting_analysis_items
FOR EACH ROW EXECUTE FUNCTION public.protect_requirement_change_source();

CREATE TRIGGER protect_approved_meeting_analysis_version
BEFORE UPDATE OR DELETE ON public.meeting_analysis_versions
FOR EACH ROW EXECUTE FUNCTION public.protect_approved_meeting_analysis_version();

CREATE TRIGGER protect_approved_meeting_analysis_evidence
BEFORE INSERT OR UPDATE OR DELETE ON public.meeting_analysis_evidence
FOR EACH ROW EXECUTE FUNCTION public.protect_approved_meeting_analysis_evidence();

CREATE OR REPLACE FUNCTION public.create_or_resume_requirement_change_set(
  p_project_id UUID,
  p_meeting_id UUID,
  p_analysis_version_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_analysis public.meeting_analysis_versions%ROWTYPE;
  v_change_set_id UUID;
  v_stale_change_set_id UUID;
  v_base_baseline_id UUID;
  v_base_baseline public.requirement_baselines%ROWTYPE;
  v_requirement public.requirements%ROWTYPE;
  v_base_requirement_id UUID;
  v_base_canonical_content TEXT;
  v_base_content_hash TEXT;
  v_base_snapshot JSONB;
  v_base_project_description TEXT;
  v_prior_review JSONB;
BEGIN
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION '仅登录用户可以创建需求变更集' USING ERRCODE = '42501';
  END IF;

  SELECT p.current_requirement_baseline_id,
         COALESCE(p.description, '')
    INTO v_base_baseline_id, v_base_project_description
    FROM public.projects p
   WHERE p.id = p_project_id
     AND p.created_by = auth.uid()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '项目不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;

  SELECT mav.* INTO v_analysis
    FROM public.meeting_analysis_versions mav
    JOIN public.meetings m ON m.id = mav.meeting_id
    JOIN public.projects p ON p.id = mav.project_id
   WHERE mav.id = p_analysis_version_id
     AND mav.project_id = p_project_id
     AND mav.meeting_id = p_meeting_id
     AND mav.status = 'approved'
     AND m.latest_analysis_version_id = mav.id
     AND m.approved_transcript_revision_id = mav.transcript_revision_id
     AND p.created_by = auth.uid()
   FOR UPDATE OF mav, m;
  IF NOT FOUND THEN
    RAISE EXCEPTION '会议分析版本未批准、不是最新版本或无权限访问' USING ERRCODE = 'P0002';
  END IF;

  SELECT rcs.id INTO v_change_set_id
    FROM public.requirement_change_sets rcs
   WHERE rcs.analysis_version_id = v_analysis.id
     AND rcs.status IN ('in_review', 'applied');
  IF v_change_set_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
        FROM public.requirement_change_sets rcs
        JOIN public.projects p ON p.id = rcs.project_id
       WHERE rcs.id = v_change_set_id
         AND (rcs.status = 'applied'
           OR rcs.base_baseline_id IS NOT DISTINCT FROM p.current_requirement_baseline_id)
    ) THEN
      RETURN v_change_set_id;
    END IF;
    v_stale_change_set_id := v_change_set_id;
    v_change_set_id := NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.meeting_analysis_items mai
    WHERE mai.analysis_version_id = v_analysis.id
      AND mai.review_status = 'accepted'
  ) THEN
    RAISE EXCEPTION '会议分析版本没有已接受的洞察项' USING ERRCODE = 'P0001';
  END IF;

  IF v_base_baseline_id IS NOT NULL THEN
    SELECT rb.* INTO v_base_baseline
      FROM public.requirement_baselines rb
     WHERE rb.id = v_base_baseline_id
       AND rb.project_id = p_project_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '项目当前需求基线不存在' USING ERRCODE = '23503';
    END IF;
    v_base_requirement_id := v_base_baseline.source_requirement_id;
    v_base_canonical_content := v_base_baseline.canonical_content;
    v_base_content_hash := v_base_baseline.content_hash;
    v_base_snapshot := v_base_baseline.snapshot;
    v_base_project_description := v_base_baseline.project_description_snapshot;
  ELSE
    SELECT r.* INTO v_requirement
      FROM public.requirements r
     WHERE r.project_id = p_project_id
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION '项目没有可用于创建初始基线的需求记录' USING ERRCODE = 'P0001';
    END IF;
    v_base_requirement_id := v_requirement.id;
    v_base_canonical_content := COALESCE(
      NULLIF(btrim(v_requirement.raw_content), ''),
      NULLIF(btrim(v_base_project_description), '')
    );
    IF v_base_canonical_content IS NULL THEN
      RAISE EXCEPTION '项目没有可用于创建初始基线的需求内容' USING ERRCODE = 'P0001';
    END IF;
    v_base_content_hash := pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_base_canonical_content, 'UTF8'), 'sha256'),
      'hex'
    );
    v_base_snapshot := jsonb_build_object(
      'schemaVersion', 'requirement-baseline-v1',
      'projectDescription', v_base_project_description,
      'sourceRequirement', jsonb_build_object(
        'id', v_requirement.id,
        'rawContent', v_base_canonical_content,
        'parsedContent', COALESCE(v_requirement.parsed_content, 'null'::jsonb)
      ),
      'sections', jsonb_build_object(
        'requirements', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', 'source-requirement-' || v_requirement.id::TEXT,
          'title', '原始需求',
          'content', v_base_canonical_content,
          'kind', 'source',
          'sourceRequirementId', v_requirement.id
        ))),
        'business_goals', '[]'::jsonb,
        'key_features', '[]'::jsonb,
        'tech_stack', '[]'::jsonb,
        'non_functional_requirements', '[]'::jsonb,
        'risks', '[]'::jsonb,
        'decisions', '[]'::jsonb,
        'action_items', '[]'::jsonb,
        'conflicts', '[]'::jsonb,
        'open_questions', '[]'::jsonb,
        'out_of_scope', '[]'::jsonb
      ),
      'appliedChangeSets', '[]'::jsonb
    );
  END IF;

  IF NOT public.is_requirement_baseline_snapshot_v1(v_base_snapshot) THEN
    RAISE EXCEPTION '固定基础需求快照无效' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.requirement_change_sets (
    project_id, meeting_id, analysis_version_id, transcript_revision_id,
    base_baseline_id, base_requirement_id, base_canonical_content,
    base_content_hash, base_snapshot, base_project_description_snapshot, created_by
  ) VALUES (
    p_project_id, p_meeting_id, v_analysis.id, v_analysis.transcript_revision_id,
    v_base_baseline_id, v_base_requirement_id, v_base_canonical_content,
    v_base_content_hash, v_base_snapshot, v_base_project_description, auth.uid()
  ) RETURNING id INTO v_change_set_id;

  IF v_stale_change_set_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_object_agg(
      rci.source_analysis_item_id::TEXT,
      jsonb_build_object(
        'operation', rci.operation,
        'targetPath', rci.target_path,
        'targetEntryId', rci.target_entry_id,
        'title', rci.title,
        'content', rci.content,
        'reviewStatus', rci.review_status
      )
    ), '{}'::jsonb)
      INTO v_prior_review
      FROM public.requirement_change_items rci
     WHERE rci.change_set_id = v_stale_change_set_id;

    UPDATE public.requirement_change_sets
       SET status = 'superseded',
           superseded_by_change_set_id = v_change_set_id,
           superseded_at = NOW(),
           updated_at = clock_timestamp()
     WHERE id = v_stale_change_set_id AND status = 'in_review';
  END IF;

  INSERT INTO public.requirement_change_items (
    project_id, change_set_id, source_analysis_version_id, source_analysis_item_id, sequence_no,
    category, operation, target_path, title, content
  )
  SELECT
    mai.project_id, v_change_set_id, mai.analysis_version_id, mai.id,
    row_number() OVER (ORDER BY mai.sequence_no) - 1,
    mai.category,
    CASE WHEN mai.category IN ('decision', 'action_item', 'conflict', 'open_question')
      THEN 'note' ELSE 'add' END,
    CASE mai.category
      WHEN 'requirement' THEN 'requirements'
      WHEN 'decision' THEN 'decisions'
      WHEN 'action_item' THEN 'action_items'
      WHEN 'risk' THEN 'risks'
      WHEN 'conflict' THEN 'conflicts'
      WHEN 'open_question' THEN 'open_questions'
      WHEN 'out_of_scope' THEN 'out_of_scope'
    END,
    mai.title, mai.description
  FROM public.meeting_analysis_items mai
  WHERE mai.analysis_version_id = v_analysis.id
    AND mai.review_status = 'accepted'
  ORDER BY mai.sequence_no;

  IF v_stale_change_set_id IS NOT NULL THEN
    UPDATE public.requirement_change_items rci
       SET operation = COALESCE(v_prior_review->rci.source_analysis_item_id::TEXT->>'operation', rci.operation),
           target_path = COALESCE(v_prior_review->rci.source_analysis_item_id::TEXT->>'targetPath', rci.target_path),
           target_entry_id = CASE
             WHEN v_prior_review->rci.source_analysis_item_id::TEXT->>'operation' IN ('replace', 'remove')
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(COALESCE(
                  v_base_snapshot->'sections'->(v_prior_review->rci.source_analysis_item_id::TEXT->>'targetPath'),
                  '[]'::jsonb
                )) entry
                WHERE entry->>'id' = v_prior_review->rci.source_analysis_item_id::TEXT->>'targetEntryId'
              )
             THEN v_prior_review->rci.source_analysis_item_id::TEXT->>'targetEntryId'
             ELSE NULL
           END,
           title = COALESCE(v_prior_review->rci.source_analysis_item_id::TEXT->>'title', rci.title),
           content = COALESCE(v_prior_review->rci.source_analysis_item_id::TEXT->>'content', rci.content),
           review_status = CASE
             WHEN v_prior_review->rci.source_analysis_item_id::TEXT->>'operation' IN ('replace', 'remove')
              AND NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(COALESCE(
                  v_base_snapshot->'sections'->(v_prior_review->rci.source_analysis_item_id::TEXT->>'targetPath'),
                  '[]'::jsonb
                )) entry
                WHERE entry->>'id' = v_prior_review->rci.source_analysis_item_id::TEXT->>'targetEntryId'
              )
             THEN 'pending'
             ELSE COALESCE(
               v_prior_review->rci.source_analysis_item_id::TEXT->>'reviewStatus',
               rci.review_status
             )
           END,
           updated_at = clock_timestamp()
     WHERE rci.change_set_id = v_change_set_id
       AND v_prior_review ? rci.source_analysis_item_id::TEXT;
  END IF;

  RETURN v_change_set_id;
EXCEPTION
  WHEN unique_violation THEN
    SELECT rcs.id INTO v_change_set_id
      FROM public.requirement_change_sets rcs
     WHERE rcs.analysis_version_id = p_analysis_version_id
       AND rcs.status IN ('in_review', 'applied')
     ORDER BY rcs.created_at DESC
     LIMIT 1;
    IF v_change_set_id IS NOT NULL THEN RETURN v_change_set_id; END IF;
    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_requirement_change_item(
  p_project_id UUID,
  p_change_set_id UUID,
  p_item_id UUID,
  p_expected_updated_at TIMESTAMP WITH TIME ZONE,
  p_operation TEXT,
  p_target_path TEXT,
  p_target_entry_id TEXT,
  p_title TEXT,
  p_content TEXT,
  p_review_status TEXT
) RETURNS TIMESTAMP WITH TIME ZONE
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_change_set public.requirement_change_sets%ROWTYPE;
  v_updated_at TIMESTAMP WITH TIME ZONE;
BEGIN
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION '仅登录用户可以审核需求变更项' USING ERRCODE = '42501';
  END IF;
  IF p_expected_updated_at IS NULL
     OR p_operation NOT IN ('add', 'replace', 'remove', 'note')
     OR p_target_path NOT IN (
       'requirements', 'business_goals', 'key_features', 'tech_stack',
       'non_functional_requirements', 'risks', 'decisions', 'action_items',
       'conflicts', 'open_questions', 'out_of_scope'
     )
     OR (p_operation IN ('replace', 'remove') AND (
       p_target_entry_id IS NULL OR char_length(btrim(p_target_entry_id)) NOT BETWEEN 1 AND 200
     ))
     OR (p_operation IN ('add', 'note') AND p_target_entry_id IS NOT NULL)
     OR p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 200
     OR p_content IS NULL OR char_length(btrim(p_content)) NOT BETWEEN 1 AND 4000
     OR p_review_status NOT IN ('pending', 'accepted', 'excluded') THEN
    RAISE EXCEPTION '需求变更审核字段无效' USING ERRCODE = '22023';
  END IF;

  SELECT rcs.* INTO v_change_set
    FROM public.requirement_change_sets rcs
    JOIN public.projects p ON p.id = rcs.project_id
   WHERE rcs.id = p_change_set_id
     AND rcs.project_id = p_project_id
     AND p.created_by = auth.uid()
   FOR UPDATE OF rcs;
  IF NOT FOUND THEN
    RAISE EXCEPTION '需求变更集不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;
  IF v_change_set.status <> 'in_review' THEN
    RAISE EXCEPTION '已应用的需求变更集不可修改' USING ERRCODE = '55000';
  END IF;
  IF v_change_set.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION '需求变更集已被其他页面更新' USING ERRCODE = '40001';
  END IF;

  IF p_operation IN ('replace', 'remove') AND NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(
        COALESCE(v_change_set.base_snapshot->'sections'->p_target_path, '[]'::jsonb)
      ) entry
     WHERE entry->>'id' = btrim(p_target_entry_id)
  ) THEN
    RAISE EXCEPTION '替换或移除的目标条目不存在于固定基础快照' USING ERRCODE = '23503';
  END IF;

  UPDATE public.requirement_change_items
     SET operation = p_operation,
         target_path = p_target_path,
         target_entry_id = CASE WHEN p_operation IN ('replace', 'remove')
           THEN btrim(p_target_entry_id) ELSE NULL END,
         title = btrim(p_title),
         content = btrim(p_content),
         review_status = p_review_status,
         updated_at = clock_timestamp()
   WHERE id = p_item_id
     AND change_set_id = v_change_set.id
     AND project_id = v_change_set.project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '需求变更项与变更集不匹配' USING ERRCODE = '23503';
  END IF;

  UPDATE public.requirement_change_sets
     SET updated_at = clock_timestamp()
   WHERE id = v_change_set.id
   RETURNING updated_at INTO v_updated_at;
  RETURN v_updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_requirement_change_set(
  p_project_id UUID,
  p_change_set_id UUID,
  p_expected_updated_at TIMESTAMP WITH TIME ZONE
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_change_set public.requirement_change_sets%ROWTYPE;
  v_analysis public.meeting_analysis_versions%ROWTYPE;
  v_project public.projects%ROWTYPE;
  v_parent public.requirement_baselines%ROWTYPE;
  v_current_requirement public.requirements%ROWTYPE;
  v_source_requirement_id UUID;
  v_base_content TEXT;
  v_project_description TEXT;
  v_changes JSONB := '[]'::jsonb;
  v_sections JSONB;
  v_entry JSONB;
  v_item RECORD;
  v_target_entry_id TEXT;
  v_snapshot JSONB;
  v_canonical_content TEXT;
  v_content_hash TEXT;
  v_revision_no INTEGER;
  v_baseline_id UUID;
BEGIN
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION '仅登录用户可以应用需求变更集' USING ERRCODE = '42501';
  END IF;
  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION '缺少需求变更集并发令牌' USING ERRCODE = '22023';
  END IF;

  SELECT rcs.* INTO v_change_set
    FROM public.requirement_change_sets rcs
    JOIN public.projects p ON p.id = rcs.project_id
   WHERE rcs.id = p_change_set_id
     AND rcs.project_id = p_project_id
     AND p.created_by = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION '需求变更集不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;
  IF v_change_set.status NOT IN ('in_review', 'applied') THEN
    RAISE EXCEPTION '当前需求变更集不能应用' USING ERRCODE = '55000';
  END IF;

  SELECT p.* INTO v_project
    FROM public.projects p
   WHERE p.id = v_change_set.project_id
     AND p.created_by = auth.uid()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '项目不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;

  SELECT rcs.* INTO v_change_set
    FROM public.requirement_change_sets rcs
   WHERE rcs.id = p_change_set_id
     AND rcs.project_id = p_project_id
   FOR UPDATE;
  IF v_change_set.status = 'applied' THEN
    RETURN v_change_set.resulting_baseline_id;
  END IF;
  IF v_change_set.status <> 'in_review' THEN
    RAISE EXCEPTION '当前需求变更集不能应用' USING ERRCODE = '55000';
  END IF;
  IF v_change_set.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION '需求变更集已被其他页面更新' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.requirement_change_items rci
    WHERE rci.change_set_id = v_change_set.id AND rci.review_status = 'pending'
  ) THEN
    RAISE EXCEPTION '仍有待审核的需求变更项' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.requirement_change_items rci
    WHERE rci.change_set_id = v_change_set.id AND rci.review_status = 'accepted'
  ) THEN
    RAISE EXCEPTION '至少需要接受一项需求变更' USING ERRCODE = 'P0001';
  END IF;

  IF v_project.current_requirement_baseline_id IS DISTINCT FROM v_change_set.base_baseline_id THEN
    RAISE EXCEPTION '项目当前需求基线已变化，请重新创建变更集' USING ERRCODE = '40001';
  END IF;

  SELECT mav.* INTO v_analysis
    FROM public.meeting_analysis_versions mav
    JOIN public.meetings m ON m.id = mav.meeting_id
   WHERE mav.id = v_change_set.analysis_version_id
     AND mav.project_id = v_change_set.project_id
     AND mav.meeting_id = v_change_set.meeting_id
     AND mav.transcript_revision_id = v_change_set.transcript_revision_id
     AND mav.status = 'approved'
     AND m.latest_analysis_version_id = mav.id
     AND m.approved_transcript_revision_id = mav.transcript_revision_id
   FOR UPDATE OF mav, m;
  IF NOT FOUND THEN
    RAISE EXCEPTION '需求变更来源会议分析已变化' USING ERRCODE = '40001';
  END IF;

  v_base_content := v_change_set.base_canonical_content;
  v_project_description := v_change_set.base_project_description_snapshot;
  v_source_requirement_id := v_change_set.base_requirement_id;
  IF v_change_set.base_baseline_id IS NOT NULL THEN
    SELECT rb.* INTO v_parent
      FROM public.requirement_baselines rb
     WHERE rb.id = v_change_set.base_baseline_id
       AND rb.project_id = v_change_set.project_id
       AND rb.content_hash = v_change_set.base_content_hash;
    IF NOT FOUND OR v_parent.snapshot IS DISTINCT FROM v_change_set.base_snapshot THEN
      RAISE EXCEPTION '需求变更集的父基线不存在或固定快照不匹配' USING ERRCODE = '23503';
    END IF;
  ELSE
    SELECT r.* INTO v_current_requirement
      FROM public.requirements r
     WHERE r.project_id = v_change_set.project_id
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND
       OR v_current_requirement.id IS DISTINCT FROM v_change_set.base_requirement_id
       OR COALESCE(NULLIF(btrim(v_current_requirement.raw_content), ''),
         NULLIF(btrim(v_project.description), '')) IS DISTINCT FROM v_base_content
       OR COALESCE(v_current_requirement.parsed_content, 'null'::jsonb)
         IS DISTINCT FROM COALESCE(
           v_change_set.base_snapshot->'sourceRequirement'->'parsedContent',
           'null'::jsonb
         )
       OR COALESCE(v_project.description, '')
         IS DISTINCT FROM v_change_set.base_project_description_snapshot THEN
      RAISE EXCEPTION '项目初始需求或描述已变化，请重新创建变更集' USING ERRCODE = '40001';
    END IF;
    IF pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_base_content, 'UTF8'), 'sha256'),
      'hex'
    ) IS DISTINCT FROM v_change_set.base_content_hash THEN
      RAISE EXCEPTION '需求变更集的固定基础内容摘要无效' USING ERRCODE = '23503';
    END IF;
  END IF;
  IF NOT public.is_requirement_baseline_snapshot_v1(v_change_set.base_snapshot) THEN
    RAISE EXCEPTION '需求变更集的固定基础快照无效' USING ERRCODE = '23514';
  END IF;

  v_snapshot := v_change_set.base_snapshot;
  v_sections := v_snapshot->'sections';

  FOR v_item IN
    SELECT rci.*
      FROM public.requirement_change_items rci
     WHERE rci.change_set_id = v_change_set.id
       AND rci.review_status = 'accepted'
     ORDER BY rci.sequence_no
  LOOP
    v_target_entry_id := v_item.target_entry_id;
    v_entry := jsonb_strip_nulls(jsonb_build_object(
      'id', 'change-item-' || v_item.id::TEXT,
      'title', v_item.title,
      'content', v_item.content,
      'kind', CASE WHEN v_item.operation = 'note' THEN 'note' ELSE 'change' END,
      'changeItemId', v_item.id
    ));

    IF v_item.operation IN ('replace', 'remove') AND NOT EXISTS (
      SELECT 1
        FROM jsonb_array_elements(COALESCE(v_sections->v_item.target_path, '[]'::jsonb)) entry
       WHERE entry->>'id' = v_target_entry_id
    ) THEN
      RAISE EXCEPTION '替换或移除的目标条目已被前序变更移除' USING ERRCODE = '23503';
    END IF;

    IF v_item.operation = 'remove' THEN
      v_sections := jsonb_set(
        v_sections,
        ARRAY[v_item.target_path],
        COALESCE((
          SELECT jsonb_agg(value ORDER BY ordinal)
            FROM jsonb_array_elements(v_sections->v_item.target_path)
              WITH ORDINALITY AS entries(value, ordinal)
           WHERE value->>'id' IS DISTINCT FROM v_target_entry_id
        ), '[]'::jsonb),
        false
      );
    ELSIF v_item.operation = 'replace' THEN
      v_entry := jsonb_set(v_entry, '{id}', to_jsonb(v_target_entry_id), true);
      v_sections := jsonb_set(
        v_sections,
        ARRAY[v_item.target_path],
        COALESCE((
          SELECT jsonb_agg(
            CASE WHEN value->>'id' = v_target_entry_id THEN v_entry ELSE value END
            ORDER BY ordinal
          )
            FROM jsonb_array_elements(v_sections->v_item.target_path)
              WITH ORDINALITY AS entries(value, ordinal)
        ), '[]'::jsonb),
        false
      );
    ELSE
      v_sections := jsonb_set(
        v_sections,
        ARRAY[v_item.target_path],
        COALESCE(v_sections->v_item.target_path, '[]'::jsonb) || jsonb_build_array(v_entry),
        false
      );
    END IF;

    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'changeItemId', v_item.id,
      'sourceAnalysisItemId', v_item.source_analysis_item_id,
      'category', v_item.category,
      'operation', v_item.operation,
      'targetPath', v_item.target_path,
      'title', v_item.title,
      'content', v_item.content
    ));
  END LOOP;

  v_snapshot := jsonb_set(v_snapshot, '{sections}', v_sections, false);
  v_snapshot := jsonb_set(
    v_snapshot,
    '{appliedChangeSets}',
    COALESCE(v_snapshot->'appliedChangeSets', '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object(
        'changeSetId', v_change_set.id,
        'meetingId', v_change_set.meeting_id,
        'transcriptRevisionId', v_change_set.transcript_revision_id,
        'analysisVersionId', v_change_set.analysis_version_id,
        'items', v_changes
      )),
    false
  );
  IF NOT public.is_requirement_baseline_snapshot_v1(v_snapshot) THEN
    RAISE EXCEPTION '生成的需求基线快照无效' USING ERRCODE = '23514';
  END IF;

  v_canonical_content := public.render_requirement_baseline_sections(v_sections);
  v_content_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_canonical_content, 'UTF8'), 'sha256'),
    'hex'
  );

  SELECT COALESCE(MAX(rb.revision_no), 0) + 1 INTO v_revision_no
    FROM public.requirement_baselines rb
   WHERE rb.project_id = v_change_set.project_id;

  INSERT INTO public.requirement_baselines (
    project_id, revision_no, parent_baseline_id, source_requirement_id,
    source_meeting_id, source_transcript_revision_id, source_analysis_version_id,
    applied_change_set_id, canonical_content, content_hash, snapshot,
    project_description_snapshot, created_by
  ) VALUES (
    v_change_set.project_id, v_revision_no, v_change_set.base_baseline_id,
    v_source_requirement_id, v_change_set.meeting_id, v_change_set.transcript_revision_id,
    v_change_set.analysis_version_id, v_change_set.id, v_canonical_content,
    v_content_hash, v_snapshot, v_project_description, auth.uid()
  ) RETURNING id INTO v_baseline_id;

  UPDATE public.requirement_change_sets
     SET status = 'applied', resulting_baseline_id = v_baseline_id,
         applied_by = auth.uid(), applied_at = NOW(), updated_at = clock_timestamp()
   WHERE id = v_change_set.id;

  PERFORM pg_catalog.set_config('presales.allow_requirement_baseline_pointer_update', 'on', true);
  UPDATE public.projects
     SET current_requirement_baseline_id = v_baseline_id,
         updated_at = NOW()
   WHERE id = v_change_set.project_id;

  RETURN v_baseline_id;
END;
$$;

REVOKE ALL ON FUNCTION public.render_requirement_baseline_sections(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_project_requirement_baseline_pointer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_requirement_baseline() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_applied_requirement_change_set() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_applied_requirement_change_item() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_requirement_change_source() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.create_or_resume_requirement_change_set(UUID, UUID, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_requirement_change_item(
  UUID, UUID, UUID, TIMESTAMP WITH TIME ZONE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_requirement_change_set(
  UUID, UUID, TIMESTAMP WITH TIME ZONE
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_or_resume_requirement_change_set(UUID, UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_requirement_change_item(
  UUID, UUID, UUID, TIMESTAMP WITH TIME ZONE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_requirement_change_set(
  UUID, UUID, TIMESTAMP WITH TIME ZONE
) TO authenticated;
