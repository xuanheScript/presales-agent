-- 修复 PL/pgSQL RETURNS TABLE 输出参数与 processing_jobs.provider_task_id 同名导致的歧义

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
#variable_conflict use_column
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
       SET status = 'transcribing', updated_at = NOW()
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
       SET status = 'transcribing', updated_at = NOW()
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

REVOKE ALL ON FUNCTION public.claim_transcription_job(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_transcription_job(UUID, TEXT, INTEGER) TO service_role;
