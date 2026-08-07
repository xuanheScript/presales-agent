-- 允许项目所有者在自动重试耗尽后，为失败的转写创建新的可审计任务。
CREATE OR REPLACE FUNCTION public.retry_failed_transcription_job(
  p_job_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_failed_job public.processing_jobs%ROWTYPE;
  v_active_job_id UUID;
  v_new_job_id UUID := pg_catalog.gen_random_uuid();
BEGIN
  SELECT pj.* INTO v_failed_job
    FROM public.processing_jobs pj
    JOIN public.projects p ON p.id = pj.project_id
   WHERE pj.id = p_job_id
     AND pj.job_type = 'transcription'
     AND p.created_by = auth.uid()
   FOR UPDATE OF pj;

  IF NOT FOUND THEN
    RAISE EXCEPTION '转写任务不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;
  IF v_failed_job.status <> 'failed' THEN
    RAISE EXCEPTION '只有失败的转写任务可以重新提交' USING ERRCODE = 'P0001';
  END IF;

  SELECT pj.id INTO v_active_job_id
    FROM public.processing_jobs pj
   WHERE pj.meeting_id = v_failed_job.meeting_id
     AND pj.job_type = 'transcription'
     AND pj.status IN ('queued', 'running')
   ORDER BY pj.created_at DESC
   LIMIT 1;

  IF v_active_job_id IS NOT NULL THEN
    RETURN v_active_job_id;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.processing_jobs pj
     WHERE pj.meeting_id = v_failed_job.meeting_id
       AND pj.job_type = 'transcription'
       AND (
         pj.created_at > v_failed_job.created_at
         OR (pj.created_at = v_failed_job.created_at AND pj.id <> v_failed_job.id)
       )
  ) THEN
    RAISE EXCEPTION '已有更新的转写任务，请刷新页面后重试' USING ERRCODE = '40001';
  END IF;
  IF v_failed_job.media_asset_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.media_assets ma
     WHERE ma.id = v_failed_job.media_asset_id
       AND ma.project_id = v_failed_job.project_id
       AND ma.meeting_id = v_failed_job.meeting_id
       AND ma.status IN ('verified', 'ready')
       AND ma.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION '原始会议音频不可用，无法重新转写' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.processing_jobs (
    id,
    project_id,
    meeting_id,
    media_asset_id,
    job_type,
    status,
    idempotency_key,
    provider,
    stage
  ) VALUES (
    v_new_job_id,
    v_failed_job.project_id,
    v_failed_job.meeting_id,
    v_failed_job.media_asset_id,
    'transcription',
    'queued',
    'transcription-retry:' || v_failed_job.id::TEXT || ':' || v_new_job_id::TEXT,
    'funasr',
    'queued'
  );

  UPDATE public.meetings
     SET status = 'transcribing', updated_at = NOW()
   WHERE id = v_failed_job.meeting_id;

  RETURN v_new_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.retry_failed_transcription_job(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_failed_transcription_job(UUID) TO authenticated;
