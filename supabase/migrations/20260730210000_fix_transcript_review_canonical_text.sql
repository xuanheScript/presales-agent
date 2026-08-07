-- 兼容 FunASR 机器稿全文与句段拼接格式不同，并保证人工稿始终使用规范全文

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
  v_canonical_text TEXT;
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

  SELECT string_agg(btrim(ts.text), E'\n' ORDER BY ts.sequence_no)
    INTO v_canonical_text
    FROM public.transcript_segments ts
   WHERE ts.transcript_revision_id = v_source.id;
  IF v_canonical_text IS NULL OR char_length(btrim(v_canonical_text)) = 0 THEN
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
    v_canonical_text,
    pg_catalog.encode(extensions.digest(v_canonical_text, 'sha256'), 'hex'),
    pg_catalog.jsonb_build_object('sourceRevisionId', v_source.id),
    v_source.config_version, auth.uid()
  ) RETURNING id INTO v_draft_id;

  INSERT INTO public.transcript_segments (
    project_id, meeting_id, transcript_revision_id, sequence_no,
    speaker_key, start_ms, end_ms, text, confidence, words, source_segment_id
  )
  SELECT
    ts.project_id, ts.meeting_id, v_draft_id, ts.sequence_no,
    ts.speaker_key, ts.start_ms, ts.end_ms, btrim(ts.text), ts.confidence, ts.words,
    COALESCE(ts.source_segment_id, ts.id)
  FROM public.transcript_segments ts
  WHERE ts.transcript_revision_id = v_source.id
  ORDER BY ts.sequence_no;

  RETURN v_draft_id;
END;
$$;

-- 修复部署 20260730200000 前后已由机器稿复制、但尚未人工保存的活动草稿。
WITH canonical AS (
  SELECT
    tr.id,
    string_agg(btrim(ts.text), E'\n' ORDER BY ts.sequence_no) AS full_text
  FROM public.transcript_revisions tr
  JOIN public.transcript_segments ts ON ts.transcript_revision_id = tr.id
  WHERE tr.kind = 'human'
    AND tr.status IN ('draft', 'in_review')
  GROUP BY tr.id
)
UPDATE public.transcript_revisions tr
   SET full_text = canonical.full_text,
       content_hash = pg_catalog.encode(
         extensions.digest(canonical.full_text, 'sha256'),
         'hex'
       ),
       updated_at = clock_timestamp()
  FROM canonical
 WHERE tr.id = canonical.id
   AND tr.full_text IS DISTINCT FROM canonical.full_text;

REVOKE ALL ON FUNCTION public.create_or_resume_human_transcript_draft(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_or_resume_human_transcript_draft(UUID)
  TO authenticated;
