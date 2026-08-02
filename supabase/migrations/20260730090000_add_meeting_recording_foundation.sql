-- 会议录音、媒体、处理任务与转写版本基础数据模型

CREATE TABLE public.meetings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'uploading', 'transcribing', 'review_required',
      'analyzing', 'estimate_ready', 'published', 'archived'
    )),
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days IN (7, 30, 90)),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_transcript_revision_id UUID,
  latest_analysis_version_id UUID,
  latest_estimate_version_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE public.media_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('original', 'normalized', 'provider_result')),
  bucket TEXT NOT NULL DEFAULT 'meeting-audio' CHECK (bucket = 'meeting-audio'),
  object_path TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL CHECK (char_length(btrim(original_filename)) BETWEEN 1 AND 255),
  mime_type TEXT,
  size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes BETWEEN 0 AND 500000000),
  duration_ms BIGINT CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 7200000),
  sample_rate INTEGER CHECK (sample_rate IS NULL OR sample_rate > 0),
  channels INTEGER CHECK (channels IS NULL OR channels > 0),
  sha256 TEXT CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN (
      'created', 'uploading', 'uploaded', 'verified', 'normalizing',
      'ready', 'failed', 'deleted'
    )),
  derived_from_asset_id UUID REFERENCES public.media_assets(id) ON DELETE SET NULL,
  retention_until TIMESTAMP WITH TIME ZONE NOT NULL,
  deleted_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CHECK (
    (status = 'deleted' AND deleted_at IS NOT NULL)
    OR (status <> 'deleted' AND deleted_at IS NULL)
  )
);

CREATE TABLE public.processing_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  media_asset_id UUID REFERENCES public.media_assets(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL
    CHECK (job_type IN (
      'transcription', 'meeting_analysis', 'estimate_generation', 'retention_cleanup'
    )),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  provider TEXT,
  provider_task_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  stage TEXT NOT NULL DEFAULT 'queued',
  event_sequence BIGINT NOT NULL DEFAULT 0 CHECK (event_sequence >= 0),
  next_poll_at TIMESTAMP WITH TIME ZONE,
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  finished_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CHECK (
    (status IN ('succeeded', 'failed', 'cancelled') AND finished_at IS NOT NULL)
    OR (status IN ('queued', 'running') AND finished_at IS NULL)
  )
);

CREATE TABLE public.transcript_revisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL CHECK (revision_no > 0),
  parent_revision_id UUID REFERENCES public.transcript_revisions(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('machine', 'human')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'approved')),
  full_text TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  model_manifest JSONB,
  config_version TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (meeting_id, revision_no),
  CHECK (
    (status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR (status <> 'approved' AND approved_by IS NULL AND approved_at IS NULL)
  )
);

CREATE TABLE public.transcript_segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  transcript_revision_id UUID NOT NULL REFERENCES public.transcript_revisions(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 0),
  speaker_key TEXT,
  start_ms BIGINT NOT NULL CHECK (start_ms >= 0),
  end_ms BIGINT NOT NULL CHECK (end_ms >= start_ms),
  text TEXT NOT NULL,
  confidence DOUBLE PRECISION CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  words JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(words) = 'array'),
  source_segment_id UUID REFERENCES public.transcript_segments(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (transcript_revision_id, sequence_no)
);

ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_approved_transcript_revision_fk
  FOREIGN KEY (approved_transcript_revision_id)
  REFERENCES public.transcript_revisions(id) ON DELETE SET NULL;

CREATE INDEX idx_meetings_project_created
  ON public.meetings(project_id, created_at DESC);
CREATE INDEX idx_media_assets_meeting
  ON public.media_assets(meeting_id, created_at DESC);
CREATE UNIQUE INDEX uq_media_assets_original_meeting
  ON public.media_assets(meeting_id)
  WHERE kind = 'original' AND status <> 'deleted';
CREATE INDEX idx_media_assets_retention
  ON public.media_assets(retention_until)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_processing_jobs_meeting
  ON public.processing_jobs(meeting_id, created_at DESC);
CREATE INDEX idx_processing_jobs_poll
  ON public.processing_jobs(status, next_poll_at, created_at)
  WHERE status IN ('queued', 'running');
CREATE UNIQUE INDEX uq_processing_jobs_active_action
  ON public.processing_jobs(meeting_id, job_type)
  WHERE status IN ('queued', 'running');
CREATE INDEX idx_transcript_revisions_meeting
  ON public.transcript_revisions(meeting_id, revision_no DESC);
CREATE INDEX idx_transcript_segments_revision
  ON public.transcript_segments(transcript_revision_id, sequence_no);

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户可以查看自己项目的会议"
  ON public.meetings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = meetings.project_id AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以创建自己项目的会议"
  ON public.meetings FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = meetings.project_id AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以更新自己项目的会议"
  ON public.meetings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = meetings.project_id AND p.created_by = auth.uid()
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = meetings.project_id AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以查看自己项目的媒体"
  ON public.media_assets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = media_assets.project_id AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以创建自己项目的媒体"
  ON public.media_assets FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.meetings m
      JOIN public.projects p ON p.id = m.project_id
      WHERE m.id = media_assets.meeting_id
        AND m.project_id = media_assets.project_id
        AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以更新自己项目的媒体"
  ON public.media_assets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = media_assets.project_id AND p.created_by = auth.uid()
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.meetings m
      JOIN public.projects p ON p.id = m.project_id
      WHERE m.id = media_assets.meeting_id
        AND m.project_id = media_assets.project_id
        AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以查看自己项目的处理任务"
  ON public.processing_jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = processing_jobs.project_id AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以查看自己项目的转写版本"
  ON public.transcript_revisions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = transcript_revisions.project_id AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以创建自己项目的转写版本"
  ON public.transcript_revisions FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.meetings m
      JOIN public.projects p ON p.id = m.project_id
      WHERE m.id = transcript_revisions.meeting_id
        AND m.project_id = transcript_revisions.project_id
        AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以更新自己项目的未批准转写版本"
  ON public.transcript_revisions FOR UPDATE
  USING (
    status <> 'approved'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = transcript_revisions.project_id AND p.created_by = auth.uid()
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.meetings m
      JOIN public.projects p ON p.id = m.project_id
      WHERE m.id = transcript_revisions.meeting_id
        AND m.project_id = transcript_revisions.project_id
        AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以查看自己项目的转写片段"
  ON public.transcript_segments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = transcript_segments.project_id AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以创建自己项目的转写片段"
  ON public.transcript_segments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.transcript_revisions tr
      JOIN public.projects p ON p.id = tr.project_id
      WHERE tr.id = transcript_segments.transcript_revision_id
        AND tr.status <> 'approved'
        AND tr.meeting_id = transcript_segments.meeting_id
        AND tr.project_id = transcript_segments.project_id
        AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以更新自己项目的未批准转写片段"
  ON public.transcript_segments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.transcript_revisions tr
      JOIN public.projects p ON p.id = tr.project_id
      WHERE tr.id = transcript_segments.transcript_revision_id
        AND tr.status <> 'approved'
        AND p.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.transcript_revisions tr
      JOIN public.projects p ON p.id = tr.project_id
      WHERE tr.id = transcript_segments.transcript_revision_id
        AND tr.status <> 'approved'
        AND tr.meeting_id = transcript_segments.meeting_id
        AND tr.project_id = transcript_segments.project_id
        AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以删除自己项目的未批准转写片段"
  ON public.transcript_segments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.transcript_revisions tr
      JOIN public.projects p ON p.id = tr.project_id
      WHERE tr.id = transcript_segments.transcript_revision_id
        AND tr.status <> 'approved'
        AND p.created_by = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.create_meeting(
  p_project_id UUID,
  p_title TEXT,
  p_retention_days INTEGER DEFAULT 30
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_meeting_id UUID;
BEGIN
  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION '会议标题长度必须为 1 到 200 个字符' USING ERRCODE = '22023';
  END IF;

  IF p_retention_days NOT IN (7, 30, 90) THEN
    RAISE EXCEPTION '音频保留期只支持 7、30 或 90 天' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.projects p
   WHERE p.id = p_project_id
     AND p.created_by = auth.uid()
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '项目不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.meetings (
    project_id, title, retention_days, created_by
  ) VALUES (
    p_project_id, btrim(p_title), p_retention_days, auth.uid()
  ) RETURNING id INTO v_meeting_id;

  RETURN v_meeting_id;
END;
$$;

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
  v_asset_id UUID := uuid_generate_v4();
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

CREATE OR REPLACE FUNCTION public.complete_meeting_audio_upload(
  p_project_id UUID,
  p_meeting_id UUID,
  p_media_asset_id UUID,
  p_size_bytes BIGINT,
  p_mime_type TEXT,
  p_sha256 TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_asset public.media_assets%ROWTYPE;
  v_job_id UUID;
BEGIN
  IF p_size_bytes <= 0 OR p_size_bytes > 500000000 THEN
    RAISE EXCEPTION '音频大小必须在 1 到 500000000 字节之间' USING ERRCODE = '22023';
  END IF;

  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION '音频 SHA-256 格式无效' USING ERRCODE = '22023';
  END IF;

  SELECT ma.* INTO v_asset
    FROM public.media_assets ma
    JOIN public.projects p ON p.id = ma.project_id
   WHERE ma.id = p_media_asset_id
     AND ma.project_id = p_project_id
     AND ma.meeting_id = p_meeting_id
     AND p.created_by = auth.uid()
   FOR UPDATE OF ma;

  IF NOT FOUND THEN
    RAISE EXCEPTION '媒体不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;

  IF v_asset.status = 'verified' THEN
    SELECT pj.id INTO v_job_id
      FROM public.processing_jobs pj
     WHERE pj.media_asset_id = v_asset.id
       AND pj.job_type = 'transcription'
     ORDER BY pj.created_at DESC
     LIMIT 1;
    IF v_job_id IS NULL THEN
      RAISE EXCEPTION '已验证媒体缺少转写任务' USING ERRCODE = '23503';
    END IF;
    RETURN v_job_id;
  END IF;

  IF v_asset.status <> 'uploading' THEN
    RAISE EXCEPTION '当前媒体状态不能完成上传: %', v_asset.status USING ERRCODE = 'P0001';
  END IF;

  IF p_mime_type IS DISTINCT FROM v_asset.mime_type THEN
    RAISE EXCEPTION '上传 MIME 与初始化记录不一致' USING ERRCODE = '22023';
  END IF;

  UPDATE public.media_assets
     SET size_bytes = p_size_bytes,
         sha256 = p_sha256,
         status = 'verified',
         updated_at = NOW(),
         error_message = NULL
   WHERE id = v_asset.id;

  INSERT INTO public.processing_jobs (
    project_id, meeting_id, media_asset_id, job_type, status,
    idempotency_key, provider, stage
  ) VALUES (
    v_asset.project_id, v_asset.meeting_id, v_asset.id, 'transcription', 'queued',
    'transcription:' || v_asset.id::TEXT || ':' || p_sha256,
    'funasr', 'queued'
  ) RETURNING id INTO v_job_id;

  UPDATE public.meetings
     SET status = 'transcribing', updated_at = NOW()
   WHERE id = v_asset.meeting_id;

  RETURN v_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_transcript_revision(
  p_meeting_id UUID,
  p_revision_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_revision public.transcript_revisions%ROWTYPE;
BEGIN
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

  IF v_revision.status = 'approved' THEN
    UPDATE public.meetings
       SET approved_transcript_revision_id = v_revision.id,
           status = 'review_required',
           updated_at = NOW()
     WHERE id = p_meeting_id;
    RETURN;
  END IF;

  UPDATE public.transcript_revisions
     SET status = 'approved', approved_by = auth.uid(), approved_at = NOW(),
         updated_at = NOW()
   WHERE id = v_revision.id;

  UPDATE public.meetings
     SET approved_transcript_revision_id = v_revision.id,
         status = 'review_required',
         updated_at = NOW()
   WHERE id = p_meeting_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_meeting(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.initialize_meeting_audio_upload(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_meeting_audio_upload(UUID, UUID, UUID, BIGINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_transcript_revision(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_meeting(UUID, TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.initialize_meeting_audio_upload(UUID, UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.complete_meeting_audio_upload(UUID, UUID, UUID, BIGINT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.approve_transcript_revision(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_meeting(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_meeting_audio_upload(UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_meeting_audio_upload(UUID, UUID, UUID, BIGINT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_transcript_revision(UUID, UUID) TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'meeting-audio',
  'meeting-audio',
  false,
  500000000,
  ARRAY[
    'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/flac', 'audio/x-flac',
    'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'video/mp4'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "用户可以上传自己的会议音频"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'meeting-audio'
    AND EXISTS (
      SELECT 1
      FROM public.media_assets ma
      JOIN public.projects p ON p.id = ma.project_id
      WHERE ma.bucket = bucket_id
        AND ma.object_path = name
        AND ma.status = 'uploading'
        AND ma.created_by = auth.uid()
        AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以查看自己的会议音频"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'meeting-audio'
    AND EXISTS (
      SELECT 1
      FROM public.media_assets ma
      JOIN public.projects p ON p.id = ma.project_id
      WHERE ma.bucket = bucket_id
        AND ma.object_path = name
        AND ma.deleted_at IS NULL
        AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以更新自己的会议音频"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'meeting-audio'
    AND EXISTS (
      SELECT 1
      FROM public.media_assets ma
      JOIN public.projects p ON p.id = ma.project_id
      WHERE ma.bucket = bucket_id
        AND ma.object_path = name
        AND ma.status = 'uploading'
        AND p.created_by = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'meeting-audio'
    AND EXISTS (
      SELECT 1
      FROM public.media_assets ma
      JOIN public.projects p ON p.id = ma.project_id
      WHERE ma.bucket = bucket_id
        AND ma.object_path = name
        AND ma.status = 'uploading'
        AND ma.created_by = auth.uid()
        AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以删除自己的会议音频"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'meeting-audio'
    AND EXISTS (
      SELECT 1
      FROM public.media_assets ma
      JOIN public.projects p ON p.id = ma.project_id
      WHERE ma.bucket = bucket_id
        AND ma.object_path = name
        AND p.created_by = auth.uid()
    )
  );
