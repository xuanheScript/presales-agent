-- 修复会议上传 RPC 在空 search_path 下无法解析 uuid_generate_v4 的问题

ALTER TABLE public.meetings
  ALTER COLUMN id SET DEFAULT pg_catalog.gen_random_uuid();

ALTER TABLE public.media_assets
  ALTER COLUMN id SET DEFAULT pg_catalog.gen_random_uuid();

ALTER TABLE public.processing_jobs
  ALTER COLUMN id SET DEFAULT pg_catalog.gen_random_uuid();

ALTER TABLE public.transcript_revisions
  ALTER COLUMN id SET DEFAULT pg_catalog.gen_random_uuid();

ALTER TABLE public.transcript_segments
  ALTER COLUMN id SET DEFAULT pg_catalog.gen_random_uuid();

CREATE OR REPLACE FUNCTION public.initialize_meeting_audio_upload(
  p_project_id UUID,
  p_meeting_id UUID,
  p_original_filename TEXT,
  p_mime_type TEXT
) RETURNS TABLE (
  media_asset_id UUID,
  bucket TEXT,
  object_path TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_meeting public.meetings%ROWTYPE;
  v_asset_id UUID := pg_catalog.gen_random_uuid();
  v_object_path TEXT;
BEGIN
  IF p_original_filename IS NULL
     OR char_length(btrim(p_original_filename)) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION '文件名长度必须为 1 到 255 个字符' USING ERRCODE = '22023';
  END IF;

  IF p_mime_type NOT IN (
    'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/flac', 'audio/x-flac',
    'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'video/mp4'
  ) THEN
    RAISE EXCEPTION '不支持的音频 MIME: %', p_mime_type USING ERRCODE = '22023';
  END IF;

  SELECT m.* INTO v_meeting
    FROM public.meetings m
    JOIN public.projects p ON p.id = m.project_id
   WHERE m.id = p_meeting_id
     AND m.project_id = p_project_id
     AND p.created_by = auth.uid()
   FOR UPDATE OF m;

  IF NOT FOUND THEN
    RAISE EXCEPTION '会议不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;

  IF v_meeting.status NOT IN ('draft', 'uploading') THEN
    RAISE EXCEPTION '当前会议状态不能创建音频上传: %', v_meeting.status USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.media_assets ma
     WHERE ma.meeting_id = p_meeting_id
       AND ma.kind = 'original'
       AND ma.status <> 'deleted'
  ) THEN
    RAISE EXCEPTION '会议已经存在原始音频' USING ERRCODE = '23505';
  END IF;

  v_object_path := auth.uid()::TEXT || '/' || v_meeting.project_id::TEXT || '/'
    || v_meeting.id::TEXT || '/' || v_asset_id::TEXT || '/audio';

  INSERT INTO public.media_assets (
    id, project_id, meeting_id, kind, object_path, original_filename,
    mime_type, status, retention_until, created_by
  ) VALUES (
    v_asset_id, v_meeting.project_id, v_meeting.id, 'original', v_object_path,
    btrim(p_original_filename), p_mime_type, 'uploading',
    NOW() + make_interval(days => v_meeting.retention_days), auth.uid()
  );

  UPDATE public.meetings
     SET status = 'uploading', updated_at = NOW()
   WHERE id = v_meeting.id;

  RETURN QUERY SELECT v_asset_id, 'meeting-audio'::TEXT, v_object_path;
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_meeting_audio_upload(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initialize_meeting_audio_upload(UUID, UUID, TEXT, TEXT)
  TO authenticated;
