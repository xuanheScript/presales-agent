-- 允许会议优先创建首个需求基线，并将会议事实与基线投影明确分离。

ALTER TABLE public.requirement_change_items
  ADD COLUMN source_title TEXT,
  ADD COLUMN source_content TEXT,
  ADD COLUMN mapping_status TEXT,
  ADD COLUMN disposition TEXT,
  ADD COLUMN mapping_reason TEXT;

-- 历史已应用变更项受不可变触发器保护。迁移只在事务内暂时关闭该触发器，
-- 完成来源/投影字段的一次性回填后立即恢复；业务 RPC 仍无法修改已应用数据。
ALTER TABLE public.requirement_change_items
  DISABLE TRIGGER protect_applied_requirement_change_item;

UPDATE public.requirement_change_items rci
   SET source_title = mai.title,
       source_content = mai.description,
       mapping_status = CASE
         WHEN rci.review_status IN ('accepted', 'excluded') THEN 'ready'
         WHEN rci.operation IN ('replace', 'remove') THEN 'decision_required'
         WHEN rci.category = 'requirement' THEN 'decision_required'
         ELSE 'auto_mapped'
       END,
       disposition = CASE
         WHEN rci.review_status = 'excluded' THEN 'omit'
         ELSE 'include'
       END,
       mapping_reason = CASE
         WHEN rci.review_status = 'accepted' THEN '迁移既有已接受审核结果'
         WHEN rci.review_status = 'excluded' THEN '迁移既有已排除审核结果'
         WHEN rci.operation IN ('replace', 'remove') THEN '既有替换或移除投影需要人工重新确认'
         WHEN rci.category = 'requirement' THEN '宽泛需求需要人工确认基线投影'
         ELSE '按洞察类别自动映射基线区段'
       END
  FROM public.meeting_analysis_items mai
 WHERE mai.id = rci.source_analysis_item_id
   AND mai.analysis_version_id = rci.source_analysis_version_id
   AND mai.project_id = rci.project_id;

ALTER TABLE public.requirement_change_items
  ENABLE TRIGGER protect_applied_requirement_change_item;

ALTER TABLE public.requirement_change_items
  ALTER COLUMN source_title SET NOT NULL,
  ALTER COLUMN source_content SET NOT NULL,
  ALTER COLUMN mapping_status SET NOT NULL,
  ALTER COLUMN mapping_status SET DEFAULT 'decision_required',
  ALTER COLUMN disposition SET NOT NULL,
  ALTER COLUMN disposition SET DEFAULT 'include',
  ALTER COLUMN mapping_reason SET NOT NULL,
  ADD CONSTRAINT requirement_change_items_source_title_check
    CHECK (char_length(btrim(source_title)) BETWEEN 1 AND 200),
  ADD CONSTRAINT requirement_change_items_source_content_check
    CHECK (char_length(btrim(source_content)) BETWEEN 1 AND 4000),
  ADD CONSTRAINT requirement_change_items_mapping_status_check
    CHECK (mapping_status IN ('auto_mapped', 'decision_required', 'ready')),
  ADD CONSTRAINT requirement_change_items_disposition_check
    CHECK (disposition IN ('include', 'omit')),
  ADD CONSTRAINT requirement_change_items_mapping_reason_check
    CHECK (char_length(mapping_reason) <= 1000);

CREATE OR REPLACE FUNCTION public.protect_requirement_change_item_source_projection()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.change_set_id IS DISTINCT FROM OLD.change_set_id
     OR NEW.source_analysis_version_id IS DISTINCT FROM OLD.source_analysis_version_id
     OR NEW.source_analysis_item_id IS DISTINCT FROM OLD.source_analysis_item_id
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.source_title IS DISTINCT FROM OLD.source_title
     OR NEW.source_content IS DISTINCT FROM OLD.source_content THEN
    RAISE EXCEPTION '需求变更项的来源事实与身份不可修改' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_requirement_change_item_source_projection
BEFORE UPDATE OF project_id, change_set_id, source_analysis_version_id,
  source_analysis_item_id, category, source_title, source_content
ON public.requirement_change_items
FOR EACH ROW EXECUTE FUNCTION public.protect_requirement_change_item_source_projection();

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
  v_prior_projection JSONB := '{}'::jsonb;
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
    SELECT 1
      FROM public.meeting_analysis_items mai
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

    IF FOUND THEN
      v_base_requirement_id := v_requirement.id;
      v_base_canonical_content := COALESCE(
        NULLIF(btrim(v_requirement.raw_content), ''),
        NULLIF(btrim(v_base_project_description), '')
      );
      IF v_base_canonical_content IS NULL THEN
        RAISE EXCEPTION '项目没有可用于创建初始基线的需求内容' USING ERRCODE = 'P0001';
      END IF;
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
    ELSE
      v_base_requirement_id := NULL;
      v_base_canonical_content := '# 项目需求基线';
      v_base_snapshot := jsonb_build_object(
        'schemaVersion', 'requirement-baseline-v1',
        'projectDescription', v_base_project_description,
        'sourceRequirement', 'null'::jsonb,
        'sections', jsonb_build_object(
          'requirements', '[]'::jsonb,
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

    v_base_content_hash := pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_base_canonical_content, 'UTF8'), 'sha256'),
      'hex'
    );
  END IF;

  IF NOT public.is_requirement_baseline_snapshot_v1(v_base_snapshot) THEN
    RAISE EXCEPTION '固定基础需求快照无效' USING ERRCODE = '23514';
  END IF;

  IF v_stale_change_set_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_object_agg(
      rci.source_analysis_item_id::TEXT,
      jsonb_build_object(
        'operation', rci.operation,
        'targetPath', rci.target_path,
        'targetEntryId', rci.target_entry_id,
        'title', rci.title,
        'content', rci.content,
        'mappingStatus', rci.mapping_status,
        'disposition', rci.disposition,
        'mappingReason', rci.mapping_reason
      )
    ), '{}'::jsonb)
      INTO v_prior_projection
      FROM public.requirement_change_items rci
     WHERE rci.change_set_id = v_stale_change_set_id;
  END IF;

  -- 先固定新 ID，再将旧变更集标记过期，以释放同一分析版本的活跃唯一索引。
  -- superseded_by 外键是延迟检查，因此可在同一事务稍后插入新变更集。
  v_change_set_id := pg_catalog.gen_random_uuid();
  IF v_stale_change_set_id IS NOT NULL THEN
    UPDATE public.requirement_change_sets
       SET status = 'superseded',
           superseded_by_change_set_id = v_change_set_id,
           superseded_at = NOW(),
           updated_at = clock_timestamp()
     WHERE id = v_stale_change_set_id
       AND status = 'in_review';
    IF NOT FOUND THEN
      RAISE EXCEPTION '原需求变更集状态已变化，请重试' USING ERRCODE = '40001';
    END IF;
  END IF;

  INSERT INTO public.requirement_change_sets (
    id, project_id, meeting_id, analysis_version_id, transcript_revision_id,
    base_baseline_id, base_requirement_id, base_canonical_content,
    base_content_hash, base_snapshot, base_project_description_snapshot, created_by
  ) VALUES (
    v_change_set_id, p_project_id, p_meeting_id, v_analysis.id,
    v_analysis.transcript_revision_id, v_base_baseline_id, v_base_requirement_id,
    v_base_canonical_content, v_base_content_hash, v_base_snapshot,
    v_base_project_description, auth.uid()
  );

  INSERT INTO public.requirement_change_items (
    project_id, change_set_id, source_analysis_version_id, source_analysis_item_id,
    sequence_no, category, operation, target_path, target_entry_id,
    source_title, source_content, title, content, mapping_status,
    disposition, mapping_reason, review_status
  )
  SELECT
    mai.project_id,
    v_change_set_id,
    mai.analysis_version_id,
    mai.id,
    ROW_NUMBER() OVER (ORDER BY mai.sequence_no, mai.id) - 1,
    mai.category,
    COALESCE(
      NULLIF(v_prior_projection->mai.id::TEXT->>'operation', ''),
      CASE WHEN mai.category = 'out_of_scope' THEN 'note' ELSE 'add' END
    ),
    COALESCE(
      NULLIF(v_prior_projection->mai.id::TEXT->>'targetPath', ''),
      CASE mai.category
        WHEN 'decision' THEN 'decisions'
        WHEN 'action_item' THEN 'action_items'
        WHEN 'risk' THEN 'risks'
        WHEN 'conflict' THEN 'conflicts'
        WHEN 'open_question' THEN 'open_questions'
        WHEN 'out_of_scope' THEN 'out_of_scope'
        ELSE 'requirements'
      END
    ),
    CASE
      WHEN v_prior_projection->mai.id::TEXT->>'operation' IN ('replace', 'remove')
       AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(COALESCE(
             v_base_snapshot->'sections'->(v_prior_projection->mai.id::TEXT->>'targetPath'),
             '[]'::jsonb
           )) entry
          WHERE entry->>'id' = v_prior_projection->mai.id::TEXT->>'targetEntryId'
       )
        THEN v_prior_projection->mai.id::TEXT->>'targetEntryId'
      ELSE NULL
    END,
    mai.title,
    mai.description,
    COALESCE(v_prior_projection->mai.id::TEXT->>'title', mai.title),
    COALESCE(v_prior_projection->mai.id::TEXT->>'content', mai.description),
    CASE
      WHEN v_prior_projection ? mai.id::TEXT
       AND v_prior_projection->mai.id::TEXT->>'operation' IN ('replace', 'remove')
       AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(COALESCE(
             v_base_snapshot->'sections'->(v_prior_projection->mai.id::TEXT->>'targetPath'),
             '[]'::jsonb
           )) entry
          WHERE entry->>'id' = v_prior_projection->mai.id::TEXT->>'targetEntryId'
       )
        THEN 'decision_required'
      WHEN v_prior_projection ? mai.id::TEXT
       AND v_prior_projection->mai.id::TEXT->>'mappingStatus' IN ('ready', 'decision_required')
        THEN v_prior_projection->mai.id::TEXT->>'mappingStatus'
      WHEN mai.category = 'requirement' THEN 'decision_required'
      ELSE 'auto_mapped'
    END,
    CASE
      WHEN v_prior_projection->mai.id::TEXT->>'disposition' IN ('include', 'omit')
        THEN v_prior_projection->mai.id::TEXT->>'disposition'
      ELSE 'include'
    END,
    CASE
      WHEN v_prior_projection ? mai.id::TEXT
       AND v_prior_projection->mai.id::TEXT->>'operation' IN ('replace', 'remove')
       AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(COALESCE(
             v_base_snapshot->'sections'->(v_prior_projection->mai.id::TEXT->>'targetPath'),
             '[]'::jsonb
           )) entry
          WHERE entry->>'id' = v_prior_projection->mai.id::TEXT->>'targetEntryId'
       )
        THEN '原替换或移除目标不在新基础快照中，需要重新确认投影'
      WHEN v_prior_projection ? mai.id::TEXT
       AND v_prior_projection->mai.id::TEXT->>'mappingStatus' IN ('ready', 'decision_required')
        THEN COALESCE(
          NULLIF(v_prior_projection->mai.id::TEXT->>'mappingReason', ''),
          '恢复此前人工基线投影决定'
        )
      WHEN mai.category = 'requirement' THEN '宽泛需求需要人工确认基线投影'
      ELSE '按洞察类别自动映射基线区段'
    END,
    CASE
      WHEN v_prior_projection->mai.id::TEXT->>'disposition' = 'omit' THEN 'excluded'
      ELSE 'accepted'
    END
  FROM public.meeting_analysis_items mai
  WHERE mai.analysis_version_id = v_analysis.id
    AND mai.review_status = 'accepted'
  ORDER BY mai.sequence_no, mai.id;

  RETURN v_change_set_id;
EXCEPTION
  WHEN unique_violation THEN
    SELECT rcs.id INTO v_change_set_id
      FROM public.requirement_change_sets rcs
     WHERE rcs.analysis_version_id = p_analysis_version_id
       AND rcs.status IN ('in_review', 'applied')
     ORDER BY rcs.created_at DESC
     LIMIT 1;
    IF v_change_set_id IS NOT NULL THEN
      RETURN v_change_set_id;
    END IF;
    RAISE;
END;
$$;

DROP FUNCTION public.save_requirement_change_item(
  UUID, UUID, UUID, TIMESTAMP WITH TIME ZONE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
);

CREATE FUNCTION public.save_requirement_change_item(
  p_project_id UUID,
  p_change_set_id UUID,
  p_item_id UUID,
  p_expected_updated_at TIMESTAMP WITH TIME ZONE,
  p_operation TEXT,
  p_target_path TEXT,
  p_target_entry_id TEXT,
  p_title TEXT,
  p_content TEXT,
  p_disposition TEXT
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
    RAISE EXCEPTION '仅登录用户可以确认需求变更投影' USING ERRCODE = '42501';
  END IF;
  IF p_expected_updated_at IS NULL
     OR p_operation NOT IN ('add', 'replace', 'remove', 'note')
     OR p_target_path NOT IN (
       'requirements', 'business_goals', 'key_features', 'tech_stack',
       'non_functional_requirements', 'risks', 'decisions', 'action_items',
       'conflicts', 'open_questions', 'out_of_scope'
     )
     OR (p_disposition = 'include' AND p_operation IN ('replace', 'remove') AND (
       p_target_entry_id IS NULL
       OR char_length(btrim(p_target_entry_id)) NOT BETWEEN 1 AND 200
     ))
     OR (p_disposition = 'include' AND p_operation IN ('add', 'note')
       AND p_target_entry_id IS NOT NULL)
     OR p_title IS NULL
     OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 200
     OR p_content IS NULL
     OR char_length(btrim(p_content)) NOT BETWEEN 1 AND 4000
     OR p_disposition NOT IN ('include', 'omit') THEN
    RAISE EXCEPTION '需求变更投影字段无效' USING ERRCODE = '22023';
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

  IF p_disposition = 'include'
     AND p_operation IN ('replace', 'remove')
     AND NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(
        COALESCE(v_change_set.base_snapshot->'sections'->p_target_path, '[]'::jsonb)
      ) entry
     WHERE entry->>'id' = btrim(p_target_entry_id)
  ) THEN
    RAISE EXCEPTION '替换或移除的目标条目不存在于固定基础快照' USING ERRCODE = '23503';
  END IF;

  IF p_disposition = 'include'
     AND p_operation IN ('replace', 'remove')
     AND EXISTS (
       SELECT 1
         FROM public.requirement_change_items rci
        WHERE rci.change_set_id = v_change_set.id
          AND rci.id <> p_item_id
          AND rci.disposition = 'include'
          AND rci.operation IN ('replace', 'remove')
          AND rci.target_path = p_target_path
          AND rci.target_entry_id = btrim(p_target_entry_id)
     ) THEN
    RAISE EXCEPTION '同一基础条目只能由一项纳入的投影替换或移除' USING ERRCODE = '23505';
  END IF;

  UPDATE public.requirement_change_items
     SET operation = p_operation,
         target_path = p_target_path,
         target_entry_id = CASE
           WHEN p_disposition = 'include'
             AND p_operation IN ('replace', 'remove') THEN btrim(p_target_entry_id)
           ELSE NULL
         END,
         title = btrim(p_title),
         content = btrim(p_content),
         mapping_status = 'ready',
         disposition = p_disposition,
         mapping_reason = '人工确认基线投影',
         review_status = CASE
           WHEN p_disposition = 'include' THEN 'accepted'
           ELSE 'excluded'
         END,
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
    SELECT 1
      FROM public.requirement_change_items rci
     WHERE rci.change_set_id = v_change_set.id
       AND rci.mapping_status = 'decision_required'
  ) THEN
    RAISE EXCEPTION '仍有需要人工确认映射的需求变更项' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.requirement_change_items rci
     WHERE rci.change_set_id = v_change_set.id
       AND rci.disposition = 'include'
  ) THEN
    RAISE EXCEPTION '至少需要包含一项需求变更' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.requirement_change_items left_item
      JOIN public.requirement_change_items right_item
        ON right_item.change_set_id = left_item.change_set_id
       AND right_item.id > left_item.id
       AND right_item.disposition = 'include'
       AND right_item.operation IN ('replace', 'remove')
       AND right_item.target_path = left_item.target_path
       AND right_item.target_entry_id = left_item.target_entry_id
     WHERE left_item.change_set_id = v_change_set.id
       AND left_item.disposition = 'include'
       AND left_item.operation IN ('replace', 'remove')
       AND left_item.target_entry_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION '多项投影不能替换或移除同一基础条目' USING ERRCODE = '23505';
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
  ELSIF v_change_set.base_requirement_id IS NOT NULL THEN
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
  ELSE
    IF EXISTS (
      SELECT 1
        FROM public.requirements r
       WHERE r.project_id = v_change_set.project_id
    )
       OR v_project.current_requirement_baseline_id IS NOT NULL
       OR v_change_set.base_snapshot->'sourceRequirement' IS DISTINCT FROM 'null'::jsonb
       OR COALESCE(v_project.description, '')
         IS DISTINCT FROM v_change_set.base_project_description_snapshot THEN
      RAISE EXCEPTION '项目初始需求状态已变化，请重新创建变更集' USING ERRCODE = '40001';
    END IF;
  END IF;

  IF pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_base_content, 'UTF8'), 'sha256'),
    'hex'
  ) IS DISTINCT FROM v_change_set.base_content_hash THEN
    RAISE EXCEPTION '需求变更集的固定基础内容摘要无效' USING ERRCODE = '23503';
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
       AND rci.disposition = 'include'
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
        FROM jsonb_array_elements(
          COALESCE(v_sections->v_item.target_path, '[]'::jsonb)
        ) entry
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
        COALESCE(v_sections->v_item.target_path, '[]'::jsonb)
          || jsonb_build_array(v_entry),
        false
      );
    END IF;

    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'changeItemId', v_item.id,
      'sourceAnalysisItemId', v_item.source_analysis_item_id,
      'category', v_item.category,
      'operation', v_item.operation,
      'targetPath', v_item.target_path,
      'targetEntryId', v_item.target_entry_id,
      'sourceTitle', v_item.source_title,
      'sourceContent', v_item.source_content,
      'title', v_item.title,
      'content', v_item.content,
      'mappingStatus', v_item.mapping_status,
      'disposition', v_item.disposition
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
    v_source_requirement_id, v_change_set.meeting_id,
    v_change_set.transcript_revision_id, v_change_set.analysis_version_id,
    v_change_set.id, v_canonical_content, v_content_hash, v_snapshot,
    v_project_description, auth.uid()
  ) RETURNING id INTO v_baseline_id;

  UPDATE public.requirement_change_sets
     SET status = 'applied',
         resulting_baseline_id = v_baseline_id,
         applied_by = auth.uid(),
         applied_at = NOW(),
         updated_at = clock_timestamp()
   WHERE id = v_change_set.id;

  PERFORM pg_catalog.set_config('presales.allow_requirement_baseline_pointer_update', 'on', true);
  UPDATE public.projects
     SET current_requirement_baseline_id = v_baseline_id,
         updated_at = NOW()
   WHERE id = v_change_set.project_id;

  RETURN v_baseline_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_meeting_analysis_version(
  p_project_id UUID,
  p_meeting_id UUID,
  p_analysis_version_id UUID,
  p_expected_updated_at TIMESTAMP WITH TIME ZONE
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version public.meeting_analysis_versions%ROWTYPE;
BEGIN
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION '仅登录用户可以批准会议分析版本' USING ERRCODE = '42501';
  END IF;
  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION '缺少会议分析版本并发令牌' USING ERRCODE = '22023';
  END IF;

  SELECT mav.* INTO v_version
    FROM public.meeting_analysis_versions mav
    JOIN public.projects p ON p.id = mav.project_id
   WHERE mav.id = p_analysis_version_id
     AND mav.project_id = p_project_id
     AND mav.meeting_id = p_meeting_id
     AND p.created_by = auth.uid()
   FOR UPDATE OF mav;
  IF NOT FOUND THEN
    RAISE EXCEPTION '会议分析版本不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;
  IF v_version.status = 'approved' THEN
    RETURN;
  END IF;
  IF v_version.status <> 'in_review' THEN
    RAISE EXCEPTION '当前会议分析版本不能批准' USING ERRCODE = '55000';
  END IF;
  IF v_version.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION '会议分析版本已被其他页面更新' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.meeting_analysis_items mai
     WHERE mai.analysis_version_id = v_version.id
       AND mai.review_status = 'pending'
  ) THEN
    RAISE EXCEPTION '仍有待审核的会议洞察项' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.meeting_analysis_items mai
     WHERE mai.analysis_version_id = v_version.id
       AND mai.review_status = 'accepted'
  ) THEN
    RAISE EXCEPTION '至少需要接受一项会议洞察才能批准分析版本' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.meetings m
     WHERE m.id = v_version.meeting_id
       AND m.project_id = v_version.project_id
       AND m.latest_analysis_version_id = v_version.id
       AND m.approved_transcript_revision_id = v_version.transcript_revision_id
     FOR UPDATE
  ) THEN
    RAISE EXCEPTION '会议当前批准稿或最新分析版本已变化' USING ERRCODE = '40001';
  END IF;

  UPDATE public.meeting_analysis_versions
     SET status = 'approved',
         reviewed_by = auth.uid(),
         reviewed_at = NOW(),
         updated_at = clock_timestamp()
   WHERE id = v_version.id;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_requirement_change_item_source_projection() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_meeting_analysis_version(
  UUID, UUID, UUID, TIMESTAMP WITH TIME ZONE
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_or_resume_requirement_change_set(UUID, UUID, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_requirement_change_item(
  UUID, UUID, UUID, TIMESTAMP WITH TIME ZONE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_requirement_change_set(
  UUID, UUID, TIMESTAMP WITH TIME ZONE
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.approve_meeting_analysis_version(
  UUID, UUID, UUID, TIMESTAMP WITH TIME ZONE
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_or_resume_requirement_change_set(UUID, UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_requirement_change_item(
  UUID, UUID, UUID, TIMESTAMP WITH TIME ZONE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_requirement_change_set(
  UUID, UUID, TIMESTAMP WITH TIME ZONE
) TO authenticated;
