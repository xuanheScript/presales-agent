-- 会议转写后台任务租约、provider 状态和机器稿原子提交

ALTER TABLE public.processing_jobs
  ADD COLUMN claimed_by TEXT,
  ADD COLUMN lease_token UUID,
  ADD COLUMN lease_expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN last_heartbeat_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.processing_jobs
  ADD CONSTRAINT processing_jobs_lease_consistency CHECK (
    (
      status = 'running'
      AND claimed_by IS NOT NULL
      AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND last_heartbeat_at IS NOT NULL
    )
    OR (
      status <> 'running'
      AND claimed_by IS NULL
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
      AND last_heartbeat_at IS NULL
    )
  ),
  ADD CONSTRAINT processing_jobs_claimed_by_length CHECK (
    claimed_by IS NULL OR char_length(claimed_by) BETWEEN 1 AND 200
  );

CREATE UNIQUE INDEX uq_processing_jobs_provider_task
  ON public.processing_jobs(provider, provider_task_id)
  WHERE provider_task_id IS NOT NULL;

CREATE INDEX idx_processing_jobs_expired_lease
  ON public.processing_jobs(lease_expires_at)
  WHERE status = 'running';

CREATE UNIQUE INDEX uq_transcript_revisions_machine_job
  ON public.transcript_revisions((model_manifest->>'processingJobId'))
  WHERE kind = 'machine' AND model_manifest ? 'processingJobId';

-- 修复已部署基础 migration 中 SECURITY INVOKER 无法通过 RLS 入队的问题。
ALTER FUNCTION public.complete_meeting_audio_upload(UUID, UUID, UUID, BIGINT, TEXT, TEXT)
  SECURITY DEFINER;

-- 用户只能直接写人工草稿；机器稿由 service-role RPC 生成，批准只允许走批准 RPC。
DROP POLICY IF EXISTS "用户可以创建自己项目的转写版本" ON public.transcript_revisions;
CREATE POLICY "用户可以创建自己项目的人工转写版本"
  ON public.transcript_revisions FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND kind = 'human'
    AND status IN ('draft', 'in_review')
    AND EXISTS (
      SELECT 1 FROM public.meetings m
      JOIN public.projects p ON p.id = m.project_id
      WHERE m.id = transcript_revisions.meeting_id
        AND m.project_id = transcript_revisions.project_id
        AND p.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "用户可以更新自己项目的未批准转写版本" ON public.transcript_revisions;
CREATE POLICY "用户可以更新自己项目的人工转写草稿"
  ON public.transcript_revisions FOR UPDATE
  USING (
    kind = 'human'
    AND status IN ('draft', 'in_review')
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = transcript_revisions.project_id AND p.created_by = auth.uid()
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    AND kind = 'human'
    AND status IN ('draft', 'in_review')
    AND EXISTS (
      SELECT 1 FROM public.meetings m
      JOIN public.projects p ON p.id = m.project_id
      WHERE m.id = transcript_revisions.meeting_id
        AND m.project_id = transcript_revisions.project_id
        AND p.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "用户可以创建自己项目的转写片段" ON public.transcript_segments;
CREATE POLICY "用户可以创建人工草稿转写片段"
  ON public.transcript_segments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.transcript_revisions tr
      JOIN public.projects p ON p.id = tr.project_id
      WHERE tr.id = transcript_segments.transcript_revision_id
        AND tr.kind = 'human'
        AND tr.status IN ('draft', 'in_review')
        AND tr.meeting_id = transcript_segments.meeting_id
        AND tr.project_id = transcript_segments.project_id
        AND p.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "用户可以更新自己项目的未批准转写片段" ON public.transcript_segments;
CREATE POLICY "用户可以更新人工草稿转写片段"
  ON public.transcript_segments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.transcript_revisions tr
      JOIN public.projects p ON p.id = tr.project_id
      WHERE tr.id = transcript_segments.transcript_revision_id
        AND tr.kind = 'human'
        AND tr.status IN ('draft', 'in_review')
        AND p.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.transcript_revisions tr
      JOIN public.projects p ON p.id = tr.project_id
      WHERE tr.id = transcript_segments.transcript_revision_id
        AND tr.kind = 'human'
        AND tr.status IN ('draft', 'in_review')
        AND tr.meeting_id = transcript_segments.meeting_id
        AND tr.project_id = transcript_segments.project_id
        AND p.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "用户可以删除自己项目的未批准转写片段" ON public.transcript_segments;
CREATE POLICY "用户可以删除人工草稿转写片段"
  ON public.transcript_segments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.transcript_revisions tr
      JOIN public.projects p ON p.id = tr.project_id
      WHERE tr.id = transcript_segments.transcript_revision_id
        AND tr.kind = 'human'
        AND tr.status IN ('draft', 'in_review')
        AND p.created_by = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.approve_transcript_revision(
  p_meeting_id UUID,
  p_revision_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_revision public.transcript_revisions%ROWTYPE;
BEGIN
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION '仅登录用户可以批准转写版本' USING ERRCODE = '42501';
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

  IF v_revision.status <> 'approved' THEN
    UPDATE public.transcript_revisions
       SET status = 'approved', approved_by = auth.uid(), approved_at = NOW(),
           updated_at = NOW()
     WHERE id = v_revision.id;
  END IF;

  UPDATE public.meetings
     SET approved_transcript_revision_id = v_revision.id,
         status = 'review_required',
         updated_at = NOW()
   WHERE id = p_meeting_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_transcript_revision(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_transcript_revision(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_transcription_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 300
) RETURNS TABLE (
  job_id UUID,
  project_id UUID,
  meeting_id UUID,
  media_asset_id UUID,
  bucket TEXT,
  object_path TEXT,
  original_filename TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  sha256 TEXT,
  lease_token UUID,
  event_sequence BIGINT,
  attempt INTEGER,
  provider_task_id TEXT,
  max_attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.processing_jobs%ROWTYPE;
  v_asset public.media_assets%ROWTYPE;
  v_lease_token UUID := gen_random_uuid();
  v_reclaim_same_worker BOOLEAN := false;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以领取转写任务' USING ERRCODE = '42501';
  END IF;
  IF p_worker_id IS NULL OR char_length(btrim(p_worker_id)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'worker ID 长度必须为 1 到 200 个字符' USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds NOT BETWEEN 30 AND 1800 THEN
    RAISE EXCEPTION '租约必须在 30 到 1800 秒之间' USING ERRCODE = '22023';
  END IF;

  SELECT pj.* INTO v_job
    FROM public.processing_jobs pj
   WHERE pj.id = p_job_id
     AND pj.job_type = 'transcription'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '转写任务不存在' USING ERRCODE = 'P0002';
  END IF;

  IF v_job.status IN ('succeeded', 'failed', 'cancelled') THEN
    RETURN;
  END IF;

  IF v_job.status = 'running' AND v_job.lease_expires_at > NOW() THEN
    IF v_job.claimed_by IS DISTINCT FROM btrim(p_worker_id) THEN
      RETURN;
    END IF;

    SELECT ma.* INTO v_asset
      FROM public.media_assets ma
     WHERE ma.id = v_job.media_asset_id
       AND ma.meeting_id = v_job.meeting_id
       AND ma.project_id = v_job.project_id
       AND ma.kind = 'original'
       AND ma.status = 'verified';
    IF NOT FOUND THEN
      RETURN;
    END IF;

    UPDATE public.processing_jobs
       SET last_heartbeat_at = NOW(),
           lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
           updated_at = NOW()
     WHERE id = v_job.id
     RETURNING * INTO v_job;

    RETURN QUERY SELECT
      v_job.id,
      v_job.project_id,
      v_job.meeting_id,
      v_job.media_asset_id,
      v_asset.bucket,
      v_asset.object_path,
      v_asset.original_filename,
      v_asset.mime_type,
      v_asset.size_bytes,
      v_asset.sha256,
      v_job.lease_token,
      v_job.event_sequence,
      v_job.attempt,
      v_job.provider_task_id,
      v_job.max_attempts;
    RETURN;
  END IF;

  v_reclaim_same_worker := v_job.status = 'running'
    AND v_job.claimed_by = btrim(p_worker_id);

  IF NOT v_reclaim_same_worker AND v_job.attempt >= v_job.max_attempts THEN
    UPDATE public.processing_jobs
       SET status = 'failed',
           stage = 'failed',
           error_code = 'ATTEMPT_LIMIT',
           error_message = '转写任务已达到最大尝试次数',
           finished_at = NOW(),
           claimed_by = NULL,
           lease_token = NULL,
           lease_expires_at = NULL,
           last_heartbeat_at = NULL,
           event_sequence = event_sequence + 1,
           updated_at = NOW()
     WHERE id = v_job.id;
    UPDATE public.meetings
       SET status = 'draft', updated_at = NOW()
     WHERE id = v_job.meeting_id;
    RETURN;
  END IF;

  SELECT ma.* INTO v_asset
    FROM public.media_assets ma
   WHERE ma.id = v_job.media_asset_id
     AND ma.meeting_id = v_job.meeting_id
     AND ma.project_id = v_job.project_id
     AND ma.kind = 'original'
     AND ma.status = 'verified';

  IF NOT FOUND THEN
    UPDATE public.processing_jobs
       SET status = 'failed',
           stage = 'failed',
           error_code = 'MEDIA_NOT_READY',
           error_message = '原始音频不存在或尚未验证',
           finished_at = NOW(),
           event_sequence = event_sequence + 1,
           updated_at = NOW()
     WHERE id = v_job.id;
    UPDATE public.meetings
       SET status = 'draft', updated_at = NOW()
     WHERE id = v_job.meeting_id;
    RETURN;
  END IF;

  UPDATE public.processing_jobs
     SET status = 'running',
         stage = CASE WHEN provider_task_id IS NULL THEN 'downloading' ELSE 'provider_polling' END,
         attempt = attempt + CASE WHEN v_reclaim_same_worker THEN 0 ELSE 1 END,
         progress_percent = CASE WHEN provider_task_id IS NULL THEN 5 ELSE GREATEST(progress_percent, 35) END,
         claimed_by = btrim(p_worker_id),
         lease_token = v_lease_token,
         lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
         last_heartbeat_at = NOW(),
         started_at = COALESCE(started_at, NOW()),
         finished_at = NULL,
         next_poll_at = NULL,
         error_code = NULL,
         error_message = NULL,
         event_sequence = event_sequence + 1,
         updated_at = NOW()
   WHERE id = v_job.id
   RETURNING * INTO v_job;

  RETURN QUERY SELECT
    v_job.id,
    v_job.project_id,
    v_job.meeting_id,
    v_job.media_asset_id,
    v_asset.bucket,
    v_asset.object_path,
    v_asset.original_filename,
    v_asset.mime_type,
    v_asset.size_bytes,
    v_asset.sha256,
    v_job.lease_token,
    v_job.event_sequence,
    v_job.attempt,
    v_job.provider_task_id,
    v_job.max_attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_transcription_job_progress(
  p_job_id UUID,
  p_lease_token UUID,
  p_stage TEXT,
  p_progress_percent INTEGER,
  p_provider_task_id TEXT DEFAULT NULL,
  p_lease_seconds INTEGER DEFAULT 300
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_sequence BIGINT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以更新转写任务' USING ERRCODE = '42501';
  END IF;
  IF p_stage IS NULL OR char_length(btrim(p_stage)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION '任务阶段长度必须为 1 到 100 个字符' USING ERRCODE = '22023';
  END IF;
  IF p_progress_percent NOT BETWEEN 0 AND 99 THEN
    RAISE EXCEPTION '运行中进度必须在 0 到 99 之间' USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds NOT BETWEEN 30 AND 1800 THEN
    RAISE EXCEPTION '租约必须在 30 到 1800 秒之间' USING ERRCODE = '22023';
  END IF;

  UPDATE public.processing_jobs
     SET stage = btrim(p_stage),
         progress_percent = GREATEST(progress_percent, p_progress_percent),
         provider_task_id = CASE
           WHEN p_provider_task_id IS NULL THEN provider_task_id
           WHEN provider_task_id IS NULL OR provider_task_id = p_provider_task_id THEN p_provider_task_id
           ELSE provider_task_id
         END,
         last_heartbeat_at = NOW(),
         lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
         event_sequence = event_sequence + 1,
         updated_at = NOW()
   WHERE id = p_job_id
     AND job_type = 'transcription'
     AND status = 'running'
     AND lease_token = p_lease_token
     AND lease_expires_at > NOW()
     AND (
       p_provider_task_id IS NULL
       OR provider_task_id IS NULL
       OR provider_task_id = p_provider_task_id
     )
   RETURNING event_sequence INTO v_event_sequence;

  IF NOT FOUND THEN
    RAISE EXCEPTION '转写任务租约无效或已过期' USING ERRCODE = '40001';
  END IF;
  RETURN v_event_sequence;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_or_retry_transcription_job(
  p_job_id UUID,
  p_lease_token UUID,
  p_error_code TEXT,
  p_error_message TEXT,
  p_retryable BOOLEAN,
  p_retry_after_seconds INTEGER DEFAULT NULL
) RETURNS TABLE (
  status TEXT,
  retry_scheduled BOOLEAN,
  next_poll_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.processing_jobs%ROWTYPE;
  v_retry_scheduled BOOLEAN;
  v_delay_seconds INTEGER;
  v_status TEXT;
  v_next_poll_at TIMESTAMP WITH TIME ZONE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以结束转写任务' USING ERRCODE = '42501';
  END IF;
  IF p_error_code IS NULL OR char_length(btrim(p_error_code)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION '错误码长度必须为 1 到 100 个字符' USING ERRCODE = '22023';
  END IF;
  IF p_retry_after_seconds IS NOT NULL AND p_retry_after_seconds NOT BETWEEN 0 AND 3600 THEN
    RAISE EXCEPTION '重试等待必须在 0 到 3600 秒之间' USING ERRCODE = '22023';
  END IF;

  SELECT pj.* INTO v_job
    FROM public.processing_jobs pj
   WHERE pj.id = p_job_id
     AND pj.job_type = 'transcription'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '转写任务不存在' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.status <> 'running'
     OR v_job.lease_token IS DISTINCT FROM p_lease_token
     OR v_job.lease_expires_at <= NOW() THEN
    RAISE EXCEPTION '转写任务租约无效或已过期' USING ERRCODE = '40001';
  END IF;

  v_retry_scheduled := p_retryable AND v_job.attempt < v_job.max_attempts;
  v_delay_seconds := COALESCE(
    p_retry_after_seconds,
    LEAST(300, 5 * CAST(power(2, GREATEST(v_job.attempt - 1, 0)) AS INTEGER))
  );

  UPDATE public.processing_jobs
     SET status = CASE WHEN v_retry_scheduled THEN 'queued' ELSE 'failed' END,
         stage = CASE WHEN v_retry_scheduled THEN 'retry_scheduled' ELSE 'failed' END,
         progress_percent = CASE WHEN v_retry_scheduled THEN 0 ELSE LEAST(progress_percent, 99) END,
         error_code = btrim(p_error_code),
         error_message = left(COALESCE(NULLIF(btrim(p_error_message), ''), '转写失败'), 1000),
         provider_task_id = CASE WHEN v_retry_scheduled THEN NULL ELSE provider_task_id END,
         finished_at = CASE WHEN v_retry_scheduled THEN NULL ELSE NOW() END,
         next_poll_at = CASE WHEN v_retry_scheduled
                             THEN NOW() + make_interval(secs => v_delay_seconds)
                             ELSE NULL END,
         claimed_by = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         last_heartbeat_at = NULL,
         event_sequence = event_sequence + 1,
         updated_at = NOW()
   WHERE id = v_job.id
   RETURNING processing_jobs.status, processing_jobs.next_poll_at
     INTO v_status, v_next_poll_at;

  UPDATE public.meetings
     SET status = 'transcribing', updated_at = NOW()
   WHERE id = v_job.meeting_id;

  RETURN QUERY SELECT v_status, v_retry_scheduled, v_next_poll_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_transcription_job(
  p_job_id UUID,
  p_lease_token UUID,
  p_error_code TEXT,
  p_error_message TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_meeting_id UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以结束转写任务' USING ERRCODE = '42501';
  END IF;
  IF p_error_code IS NULL OR char_length(btrim(p_error_code)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION '错误码长度必须为 1 到 100 个字符' USING ERRCODE = '22023';
  END IF;

  UPDATE public.processing_jobs
     SET status = 'failed',
         stage = 'failed',
         progress_percent = LEAST(progress_percent, 99),
         error_code = btrim(p_error_code),
         error_message = left(COALESCE(NULLIF(btrim(p_error_message), ''), '转写失败'), 1000),
         finished_at = NOW(),
         next_poll_at = NULL,
         claimed_by = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         last_heartbeat_at = NULL,
         event_sequence = event_sequence + 1,
         updated_at = NOW()
   WHERE id = p_job_id
     AND job_type = 'transcription'
     AND status = 'running'
     AND lease_token = p_lease_token
     AND lease_expires_at > NOW()
   RETURNING meeting_id INTO v_meeting_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.meetings
     SET status = 'draft', updated_at = NOW()
   WHERE id = v_meeting_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_transcription_job(
  p_job_id UUID,
  p_lease_token UUID,
  p_full_text TEXT,
  p_content_hash TEXT,
  p_model_manifest JSONB,
  p_config_version TEXT,
  p_segments JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.processing_jobs%ROWTYPE;
  v_revision_id UUID;
  v_revision_no INTEGER;
  v_segment JSONB;
  v_sequence_no INTEGER;
  v_start_ms BIGINT;
  v_end_ms BIGINT;
  v_segment_text TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以提交转写结果' USING ERRCODE = '42501';
  END IF;
  IF p_full_text IS NULL OR char_length(btrim(p_full_text)) = 0 THEN
    RAISE EXCEPTION '转写全文不能为空' USING ERRCODE = '22023';
  END IF;
  IF p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION '转写内容摘要格式无效' USING ERRCODE = '22023';
  END IF;
  IF p_model_manifest IS NULL OR jsonb_typeof(p_model_manifest) <> 'object' THEN
    RAISE EXCEPTION '模型清单必须为 JSON 对象' USING ERRCODE = '22023';
  END IF;
  IF p_model_manifest->>'processingJobId' IS DISTINCT FROM p_job_id::TEXT THEN
    RAISE EXCEPTION '模型清单的 processingJobId 与任务不一致' USING ERRCODE = '23503';
  END IF;
  IF p_segments IS NULL OR jsonb_typeof(p_segments) <> 'array' THEN
    RAISE EXCEPTION '转写片段必须为 JSON 数组' USING ERRCODE = '22023';
  END IF;

  SELECT pj.* INTO v_job
    FROM public.processing_jobs pj
   WHERE pj.id = p_job_id
     AND pj.job_type = 'transcription'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '转写任务不存在' USING ERRCODE = 'P0002';
  END IF;

  IF v_job.status = 'succeeded' THEN
    SELECT tr.id INTO v_revision_id
      FROM public.transcript_revisions tr
     WHERE tr.kind = 'machine'
       AND tr.model_manifest->>'processingJobId' = p_job_id::TEXT;
    IF v_revision_id IS NULL THEN
      RAISE EXCEPTION '已完成任务缺少机器转写版本' USING ERRCODE = '23503';
    END IF;
    RETURN v_revision_id;
  END IF;

  IF v_job.status <> 'running'
     OR v_job.lease_token IS DISTINCT FROM p_lease_token
     OR v_job.lease_expires_at <= NOW() THEN
    RAISE EXCEPTION '转写任务租约无效' USING ERRCODE = '40001';
  END IF;

  PERFORM 1 FROM public.meetings m
   WHERE m.id = v_job.meeting_id
     AND m.project_id = v_job.project_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '任务关联会议不存在' USING ERRCODE = '23503';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_job.meeting_id::TEXT, 0));
  SELECT COALESCE(MAX(tr.revision_no), 0) + 1
    INTO v_revision_no
    FROM public.transcript_revisions tr
   WHERE tr.meeting_id = v_job.meeting_id;

  INSERT INTO public.transcript_revisions (
    project_id, meeting_id, revision_no, kind, status, full_text,
    content_hash, model_manifest, config_version, created_by
  )
  SELECT
    v_job.project_id, v_job.meeting_id, v_revision_no, 'machine', 'in_review',
    p_full_text, p_content_hash, p_model_manifest, p_config_version, m.created_by
  FROM public.meetings m
  WHERE m.id = v_job.meeting_id
  RETURNING id INTO v_revision_id;

  FOR v_segment IN SELECT value FROM jsonb_array_elements(p_segments)
  LOOP
    IF jsonb_typeof(v_segment) <> 'object' THEN
      RAISE EXCEPTION '转写片段必须为 JSON 对象' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_sequence_no := (v_segment->>'sequenceNo')::INTEGER;
      v_start_ms := (v_segment->>'startMs')::BIGINT;
      v_end_ms := (v_segment->>'endMs')::BIGINT;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION '转写片段序号或时间码无效' USING ERRCODE = '22023';
    END;
    v_segment_text := v_segment->>'text';
    IF v_sequence_no < 0 OR v_start_ms < 0 OR v_end_ms < v_start_ms
       OR v_segment_text IS NULL OR char_length(btrim(v_segment_text)) = 0 THEN
      RAISE EXCEPTION '转写片段字段无效' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.transcript_segments (
      project_id, meeting_id, transcript_revision_id, sequence_no,
      speaker_key, start_ms, end_ms, text, confidence, words
    ) VALUES (
      v_job.project_id,
      v_job.meeting_id,
      v_revision_id,
      v_sequence_no,
      NULLIF(v_segment->>'speakerKey', ''),
      v_start_ms,
      v_end_ms,
      v_segment_text,
      CASE
        WHEN v_segment->'confidence' IS NULL OR v_segment->'confidence' = 'null'::jsonb THEN NULL
        ELSE (v_segment->>'confidence')::DOUBLE PRECISION
      END,
      COALESCE(v_segment->'words', '[]'::jsonb)
    );
  END LOOP;

  UPDATE public.processing_jobs
     SET status = 'succeeded',
         stage = 'complete',
         progress_percent = 100,
         error_code = NULL,
         error_message = NULL,
         finished_at = NOW(),
         next_poll_at = NULL,
         claimed_by = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         last_heartbeat_at = NULL,
         event_sequence = event_sequence + 1,
         updated_at = NOW()
   WHERE id = v_job.id;

  UPDATE public.meetings
     SET status = 'review_required', updated_at = NOW()
   WHERE id = v_job.meeting_id;

  RETURN v_revision_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_transcription_job(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_transcription_job_progress(UUID, UUID, TEXT, INTEGER, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_or_retry_transcription_job(UUID, UUID, TEXT, TEXT, BOOLEAN, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_transcription_job(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_transcription_job(UUID, UUID, TEXT, TEXT, JSONB, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_transcription_job(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_transcription_job_progress(UUID, UUID, TEXT, INTEGER, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_or_retry_transcription_job(UUID, UUID, TEXT, TEXT, BOOLEAN, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_transcription_job(UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_transcription_job(UUID, UUID, TEXT, TEXT, JSONB, TEXT, JSONB) TO service_role;
