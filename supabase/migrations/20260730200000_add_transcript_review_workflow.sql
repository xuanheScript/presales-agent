-- 人工转写校对草稿、原子保存、乐观并发与批准约束

CREATE UNIQUE INDEX uq_transcript_revisions_active_human_draft
  ON public.transcript_revisions(meeting_id)
  WHERE kind = 'human' AND status IN ('draft', 'in_review');

CREATE OR REPLACE FUNCTION public.create_or_resume_human_transcript_draft(
  p_meeting_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_meeting public.meetings%ROWTYPE;
  v_source public.transcript_revisions%ROWTYPE;
  v_draft_id UUID;
  v_revision_no INTEGER;
BEGIN
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION '仅登录用户可以创建校对草稿' USING ERRCODE = '42501';
  END IF;

  SELECT m.* INTO v_meeting
    FROM public.meetings m
    JOIN public.projects p ON p.id = m.project_id
   WHERE m.id = p_meeting_id
     AND p.created_by = auth.uid()
   FOR UPDATE OF m;

  IF NOT FOUND THEN
    RAISE EXCEPTION '会议不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_meeting.id::TEXT, 0)
  );

  SELECT tr.id INTO v_draft_id
    FROM public.transcript_revisions tr
   WHERE tr.meeting_id = v_meeting.id
     AND tr.kind = 'human'
     AND tr.status IN ('draft', 'in_review')
   ORDER BY tr.revision_no DESC
   LIMIT 1;

  IF v_draft_id IS NOT NULL THEN
    RETURN v_draft_id;
  END IF;

  IF v_meeting.approved_transcript_revision_id IS NOT NULL THEN
    SELECT tr.* INTO v_source
      FROM public.transcript_revisions tr
     WHERE tr.id = v_meeting.approved_transcript_revision_id
       AND tr.meeting_id = v_meeting.id
       AND tr.status = 'approved';
  ELSE
    SELECT tr.* INTO v_source
      FROM public.transcript_revisions tr
     WHERE tr.meeting_id = v_meeting.id
       AND tr.kind = 'machine'
       AND tr.status = 'in_review'
     ORDER BY tr.revision_no DESC
     LIMIT 1;
  END IF;

  IF v_source.id IS NULL THEN
    RAISE EXCEPTION '会议尚无可校对的转写版本' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.transcript_segments ts
     WHERE ts.transcript_revision_id = v_source.id
  ) THEN
    RAISE EXCEPTION '来源转写版本没有可校对片段' USING ERRCODE = '23503';
  END IF;

  SELECT COALESCE(MAX(tr.revision_no), 0) + 1
    INTO v_revision_no
    FROM public.transcript_revisions tr
   WHERE tr.meeting_id = v_meeting.id;

  INSERT INTO public.transcript_revisions (
    project_id, meeting_id, revision_no, parent_revision_id, kind, status,
    full_text, content_hash, model_manifest, config_version, created_by
  ) VALUES (
    v_meeting.project_id, v_meeting.id, v_revision_no, v_source.id, 'human', 'draft',
    v_source.full_text, v_source.content_hash,
    pg_catalog.jsonb_build_object('sourceRevisionId', v_source.id),
    v_source.config_version, auth.uid()
  ) RETURNING id INTO v_draft_id;

  INSERT INTO public.transcript_segments (
    project_id, meeting_id, transcript_revision_id, sequence_no,
    speaker_key, start_ms, end_ms, text, confidence, words, source_segment_id
  )
  SELECT
    ts.project_id, ts.meeting_id, v_draft_id, ts.sequence_no,
    ts.speaker_key, ts.start_ms, ts.end_ms, ts.text, ts.confidence, ts.words,
    COALESCE(ts.source_segment_id, ts.id)
  FROM public.transcript_segments ts
  WHERE ts.transcript_revision_id = v_source.id
  ORDER BY ts.sequence_no;

  RETURN v_draft_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_human_transcript_draft(
  p_meeting_id UUID,
  p_revision_id UUID,
  p_expected_updated_at TIMESTAMP WITH TIME ZONE,
  p_full_text TEXT,
  p_content_hash TEXT,
  p_segments JSONB
) RETURNS TIMESTAMP WITH TIME ZONE
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_revision public.transcript_revisions%ROWTYPE;
  v_segment JSONB;
  v_sequence_no INTEGER;
  v_expected_sequence INTEGER := 0;
  v_start_ms BIGINT;
  v_end_ms BIGINT;
  v_segment_text TEXT;
  v_speaker_key TEXT;
  v_source_segment_id UUID;
  v_reconstructed_text TEXT := '';
  v_new_updated_at TIMESTAMP WITH TIME ZONE;
BEGIN
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION '仅登录用户可以保存校对草稿' USING ERRCODE = '42501';
  END IF;
  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION '缺少校对版本并发令牌' USING ERRCODE = '22023';
  END IF;
  IF p_full_text IS NULL OR char_length(btrim(p_full_text)) = 0 THEN
    RAISE EXCEPTION '校对全文不能为空' USING ERRCODE = '22023';
  END IF;
  IF p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION '校对内容摘要格式无效' USING ERRCODE = '22023';
  END IF;
  IF p_segments IS NULL OR jsonb_typeof(p_segments) <> 'array'
     OR jsonb_array_length(p_segments) NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION '校对片段必须是包含 1 到 10000 项的数组' USING ERRCODE = '22023';
  END IF;

  SELECT tr.* INTO v_revision
    FROM public.transcript_revisions tr
    JOIN public.projects p ON p.id = tr.project_id
   WHERE tr.id = p_revision_id
     AND tr.meeting_id = p_meeting_id
     AND p.created_by = auth.uid()
   FOR UPDATE OF tr;

  IF NOT FOUND THEN
    RAISE EXCEPTION '校对版本不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;
  IF v_revision.kind <> 'human' OR v_revision.status NOT IN ('draft', 'in_review') THEN
    RAISE EXCEPTION '当前转写版本不可编辑' USING ERRCODE = 'P0001';
  END IF;
  IF v_revision.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION '校对稿已被其他页面更新，请重新加载' USING ERRCODE = '40001';
  END IF;

  FOR v_segment IN SELECT value FROM jsonb_array_elements(p_segments)
  LOOP
    IF jsonb_typeof(v_segment) <> 'object' THEN
      RAISE EXCEPTION '校对片段必须为 JSON 对象' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_sequence_no := (v_segment->>'sequenceNo')::INTEGER;
      v_start_ms := (v_segment->>'startMs')::BIGINT;
      v_end_ms := (v_segment->>'endMs')::BIGINT;
      v_source_segment_id := NULLIF(v_segment->>'sourceSegmentId', '')::UUID;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION '校对片段序号、时间码或来源 ID 无效' USING ERRCODE = '22023';
    END;

    v_segment_text := btrim(v_segment->>'text');
    v_speaker_key := NULLIF(btrim(v_segment->>'speakerKey'), '');
    IF v_sequence_no <> v_expected_sequence
       OR v_start_ms < 0 OR v_end_ms < v_start_ms OR v_end_ms > 7200000
       OR v_segment_text IS NULL OR char_length(v_segment_text) = 0
       OR (v_speaker_key IS NOT NULL AND char_length(v_speaker_key) > 100)
       OR jsonb_typeof(COALESCE(v_segment->'words', '[]'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION '校对片段字段无效或序号不连续' USING ERRCODE = '22023';
    END IF;

    IF v_source_segment_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.transcript_segments source_segment
       WHERE source_segment.id = v_source_segment_id
         AND source_segment.meeting_id = p_meeting_id
    ) THEN
      RAISE EXCEPTION '校对片段来源与会议不匹配' USING ERRCODE = '23503';
    END IF;

    v_reconstructed_text := v_reconstructed_text
      || CASE WHEN v_expected_sequence = 0 THEN '' ELSE E'\n' END
      || v_segment_text;
    v_expected_sequence := v_expected_sequence + 1;
  END LOOP;

  IF p_full_text IS DISTINCT FROM v_reconstructed_text THEN
    RAISE EXCEPTION '校对全文与片段内容不一致' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.transcript_segments ts
   WHERE ts.transcript_revision_id = v_revision.id;

  INSERT INTO public.transcript_segments (
    project_id, meeting_id, transcript_revision_id, sequence_no,
    speaker_key, start_ms, end_ms, text, confidence, words, source_segment_id
  )
  SELECT
    v_revision.project_id,
    v_revision.meeting_id,
    v_revision.id,
    (segment.value->>'sequenceNo')::INTEGER,
    NULLIF(btrim(segment.value->>'speakerKey'), ''),
    (segment.value->>'startMs')::BIGINT,
    (segment.value->>'endMs')::BIGINT,
    btrim(segment.value->>'text'),
    CASE
      WHEN segment.value->'confidence' IS NULL
        OR segment.value->'confidence' = 'null'::jsonb THEN NULL
      ELSE (segment.value->>'confidence')::DOUBLE PRECISION
    END,
    COALESCE(segment.value->'words', '[]'::jsonb),
    NULLIF(segment.value->>'sourceSegmentId', '')::UUID
  FROM jsonb_array_elements(p_segments) WITH ORDINALITY AS segment(value, ordinal)
  ORDER BY segment.ordinal;

  v_new_updated_at := clock_timestamp();
  UPDATE public.transcript_revisions
     SET full_text = p_full_text,
         content_hash = p_content_hash,
         updated_at = v_new_updated_at
   WHERE id = v_revision.id;

  RETURN v_new_updated_at;
END;
$$;

DROP FUNCTION IF EXISTS public.approve_transcript_revision(UUID, UUID);

CREATE FUNCTION public.approve_transcript_revision(
  p_meeting_id UUID,
  p_revision_id UUID,
  p_expected_updated_at TIMESTAMP WITH TIME ZONE
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_revision public.transcript_revisions%ROWTYPE;
  v_segment_text TEXT;
BEGIN
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION '仅登录用户可以批准转写版本' USING ERRCODE = '42501';
  END IF;
  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION '缺少校对版本并发令牌' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.meetings m
    JOIN public.projects p ON p.id = m.project_id
   WHERE m.id = p_meeting_id
     AND p.created_by = auth.uid()
   FOR UPDATE OF m;

  IF NOT FOUND THEN
    RAISE EXCEPTION '会议不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;

  SELECT tr.* INTO v_revision
    FROM public.transcript_revisions tr
   WHERE tr.id = p_revision_id
     AND tr.meeting_id = p_meeting_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '转写版本与会议不匹配' USING ERRCODE = '23503';
  END IF;
  IF v_revision.kind <> 'human' THEN
    RAISE EXCEPTION '只能批准人工校对版本' USING ERRCODE = 'P0001';
  END IF;
  IF v_revision.status = 'approved' THEN
    UPDATE public.meetings
       SET approved_transcript_revision_id = v_revision.id,
           status = 'review_required',
           updated_at = clock_timestamp()
     WHERE id = p_meeting_id;
    RETURN;
  END IF;
  IF v_revision.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION '校对稿已被其他页面更新，请重新加载' USING ERRCODE = '40001';
  END IF;

  SELECT string_agg(ts.text, E'\n' ORDER BY ts.sequence_no)
    INTO v_segment_text
    FROM public.transcript_segments ts
   WHERE ts.transcript_revision_id = v_revision.id;

  IF v_segment_text IS NULL OR char_length(btrim(v_segment_text)) = 0
     OR v_revision.full_text IS DISTINCT FROM v_segment_text THEN
    RAISE EXCEPTION '校对稿片段为空或与全文不一致' USING ERRCODE = '23514';
  END IF;

  IF v_revision.status NOT IN ('draft', 'in_review') THEN
    RAISE EXCEPTION '当前转写版本不可批准' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.transcript_revisions
     SET status = 'approved',
         approved_by = auth.uid(),
         approved_at = clock_timestamp(),
         updated_at = clock_timestamp()
   WHERE id = v_revision.id;

  UPDATE public.meetings
     SET approved_transcript_revision_id = v_revision.id,
         status = 'review_required',
         updated_at = clock_timestamp()
   WHERE id = p_meeting_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_or_resume_human_transcript_draft(UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_human_transcript_draft(UUID, UUID, TIMESTAMP WITH TIME ZONE, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_transcript_revision(UUID, UUID, TIMESTAMP WITH TIME ZONE)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_or_resume_human_transcript_draft(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_human_transcript_draft(UUID, UUID, TIMESTAMP WITH TIME ZONE, TEXT, TEXT, JSONB)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_transcript_revision(UUID, UUID, TIMESTAMP WITH TIME ZONE)
  TO authenticated;
