-- 会议洞察逐项校对、乐观并发保存和版本批准

CREATE OR REPLACE FUNCTION public.save_meeting_analysis_item(
  p_project_id UUID,
  p_meeting_id UUID,
  p_analysis_version_id UUID,
  p_item_id UUID,
  p_expected_version_updated_at TIMESTAMP WITH TIME ZONE,
  p_title TEXT,
  p_description TEXT,
  p_review_status TEXT
) RETURNS TIMESTAMP WITH TIME ZONE
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version public.meeting_analysis_versions%ROWTYPE;
  v_updated_at TIMESTAMP WITH TIME ZONE;
BEGIN
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION '仅登录用户可以审核会议洞察' USING ERRCODE = '42501';
  END IF;
  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 200
     OR p_description IS NULL OR char_length(btrim(p_description)) NOT BETWEEN 1 AND 4000
     OR p_review_status NOT IN ('pending', 'accepted', 'excluded') THEN
    RAISE EXCEPTION '会议洞察审核字段无效' USING ERRCODE = '22023';
  END IF;
  IF p_expected_version_updated_at IS NULL THEN
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
  IF v_version.status <> 'in_review' THEN
    RAISE EXCEPTION '已批准的会议分析版本不可修改' USING ERRCODE = '55000';
  END IF;
  IF v_version.updated_at IS DISTINCT FROM p_expected_version_updated_at THEN
    RAISE EXCEPTION '会议分析版本已被其他页面更新' USING ERRCODE = '40001';
  END IF;

  UPDATE public.meeting_analysis_items
     SET title = btrim(p_title),
         description = btrim(p_description),
         review_status = p_review_status,
         updated_at = clock_timestamp()
   WHERE id = p_item_id
     AND analysis_version_id = v_version.id
     AND project_id = v_version.project_id
     AND meeting_id = v_version.meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '会议洞察项与分析版本不匹配' USING ERRCODE = '23503';
  END IF;

  UPDATE public.meeting_analysis_versions
     SET updated_at = clock_timestamp()
   WHERE id = v_version.id
   RETURNING updated_at INTO v_updated_at;
  RETURN v_updated_at;
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

REVOKE ALL ON FUNCTION public.save_meeting_analysis_item(UUID, UUID, UUID, UUID, TIMESTAMP WITH TIME ZONE, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_meeting_analysis_version(UUID, UUID, UUID, TIMESTAMP WITH TIME ZONE)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_meeting_analysis_item(UUID, UUID, UUID, UUID, TIMESTAMP WITH TIME ZONE, TEXT, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_meeting_analysis_version(UUID, UUID, UUID, TIMESTAMP WITH TIME ZONE)
  TO authenticated;
