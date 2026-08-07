-- 简化会议确认流程，并为失败的会议提炼提供可审计人工重试。

CREATE OR REPLACE FUNCTION public.retry_failed_meeting_analysis_job(
  p_job_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_failed_job public.processing_jobs%ROWTYPE;
  v_failed_input public.meeting_analysis_job_inputs%ROWTYPE;
  v_meeting public.meetings%ROWTYPE;
  v_active_job_id UUID;
  v_new_job_id UUID := pg_catalog.gen_random_uuid();
BEGIN
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION '仅登录用户可以重新提交会议提炼任务' USING ERRCODE = '42501';
  END IF;

  SELECT pj.* INTO v_failed_job
    FROM public.processing_jobs pj
    JOIN public.projects p ON p.id = pj.project_id
   WHERE pj.id = p_job_id
     AND pj.job_type = 'meeting_analysis'
     AND p.created_by = auth.uid()
   FOR UPDATE OF pj;

  IF NOT FOUND THEN
    RAISE EXCEPTION '会议提炼任务不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;
  IF v_failed_job.status <> 'failed' THEN
    RAISE EXCEPTION '只有失败的会议提炼任务可以重新提交' USING ERRCODE = 'P0001';
  END IF;

  SELECT maji.* INTO v_failed_input
    FROM public.meeting_analysis_job_inputs maji
   WHERE maji.processing_job_id = v_failed_job.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '失败任务缺少固定输入快照' USING ERRCODE = '23503';
  END IF;

  SELECT m.* INTO v_meeting
    FROM public.meetings m
   WHERE m.id = v_failed_job.meeting_id
     AND m.project_id = v_failed_job.project_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '会议不存在' USING ERRCODE = '23503';
  END IF;
  IF v_meeting.status = 'archived' THEN
    RAISE EXCEPTION '归档会议不能重新提炼需求' USING ERRCODE = 'P0001';
  END IF;
  IF v_meeting.approved_transcript_revision_id IS DISTINCT FROM v_failed_input.transcript_revision_id THEN
    RAISE EXCEPTION '会议记录已更新，请基于最新确认版本重新提炼' USING ERRCODE = '40001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.transcript_revisions tr
     WHERE tr.id = v_failed_input.transcript_revision_id
       AND tr.project_id = v_failed_input.project_id
       AND tr.meeting_id = v_failed_input.meeting_id
       AND tr.status = 'approved'
       AND tr.content_hash = v_failed_input.transcript_content_hash
  ) THEN
    RAISE EXCEPTION '失败任务的会议记录输入已失效' USING ERRCODE = '40001';
  END IF;

  SELECT pj.id INTO v_active_job_id
    FROM public.processing_jobs pj
   WHERE pj.meeting_id = v_failed_job.meeting_id
     AND pj.job_type = 'meeting_analysis'
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
       AND pj.job_type = 'meeting_analysis'
       AND (
         pj.created_at > v_failed_job.created_at
         OR (pj.created_at = v_failed_job.created_at AND pj.id <> v_failed_job.id)
       )
  ) THEN
    RAISE EXCEPTION '已有更新的会议提炼任务，请刷新页面后重试' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.processing_jobs (
    id, project_id, meeting_id, job_type, status, idempotency_key,
    provider, stage, max_attempts
  ) VALUES (
    v_new_job_id, v_failed_job.project_id, v_failed_job.meeting_id,
    'meeting_analysis', 'queued',
    'meeting-analysis-retry:' || v_failed_job.id::TEXT || ':' || v_new_job_id::TEXT,
    v_failed_job.provider, 'queued', v_failed_job.max_attempts
  );

  INSERT INTO public.meeting_analysis_job_inputs (
    processing_job_id, project_id, meeting_id, transcript_revision_id,
    transcript_content_hash, model_id, prompt_version, schema_version, config_version
  ) VALUES (
    v_new_job_id, v_failed_input.project_id, v_failed_input.meeting_id,
    v_failed_input.transcript_revision_id, v_failed_input.transcript_content_hash,
    v_failed_input.model_id, v_failed_input.prompt_version,
    v_failed_input.schema_version, v_failed_input.config_version
  );

  UPDATE public.meetings
     SET status = 'analyzing', updated_at = clock_timestamp()
   WHERE id = v_failed_job.meeting_id;

  RETURN v_new_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.retry_failed_meeting_analysis_job(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_failed_meeting_analysis_job(UUID) TO authenticated;

-- Trigger.dev 调度失败发生在任务领取前。将未被领取的 queued 任务转为可审计失败，
-- 避免任务永久停留在“处理中”，并允许沿用现有人工重试链路。
CREATE OR REPLACE FUNCTION public.mark_processing_job_dispatch_failed(
  p_job_id UUID,
  p_expected_job_type TEXT,
  p_error_message TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.processing_jobs%ROWTYPE;
BEGIN
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION '仅登录用户可以记录任务调度失败' USING ERRCODE = '42501';
  END IF;
  IF p_expected_job_type NOT IN ('transcription', 'meeting_analysis') THEN
    RAISE EXCEPTION '任务类型不支持调度失败恢复' USING ERRCODE = '22023';
  END IF;

  SELECT pj.* INTO v_job
    FROM public.processing_jobs pj
    JOIN public.projects p ON p.id = pj.project_id
   WHERE pj.id = p_job_id
     AND pj.job_type = p_expected_job_type
     AND p.created_by = auth.uid()
   FOR UPDATE OF pj;
  IF NOT FOUND THEN
    RAISE EXCEPTION '处理任务不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;

  -- 调度请求可能在响应中断前已经被后台接受。任务一旦被领取或结束，
  -- 不再改写其状态，让后台任务继续按租约与幂等规则处理。
  IF v_job.status <> 'queued'
     OR v_job.attempt <> 0
     OR v_job.stage <> 'queued' THEN
    RETURN v_job.status;
  END IF;

  UPDATE public.processing_jobs
     SET status = 'failed',
         stage = 'failed',
         progress_percent = 0,
         error_code = 'TASK_DISPATCH_FAILED',
         error_message = left(
           COALESCE(NULLIF(btrim(p_error_message), ''), '后台任务调度失败'),
           1000
         ),
         finished_at = clock_timestamp(),
         next_poll_at = NULL,
         claimed_by = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         last_heartbeat_at = NULL,
         event_sequence = event_sequence + 1,
         updated_at = clock_timestamp()
   WHERE id = v_job.id;

  UPDATE public.meetings
     SET status = CASE
           WHEN v_job.job_type = 'transcription' THEN 'draft'
           ELSE 'review_required'
         END,
         updated_at = clock_timestamp()
   WHERE id = v_job.meeting_id;

  RETURN 'failed';
END;
$$;

REVOKE ALL ON FUNCTION public.mark_processing_job_dispatch_failed(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_processing_job_dispatch_failed(UUID, TEXT, TEXT)
  TO authenticated;

-- 指针只表示当前批准稿对应的最新提炼。旧版本继续保留在版本表中用于审计。
CREATE OR REPLACE FUNCTION public.invalidate_stale_meeting_analysis_pointer()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.approved_transcript_revision_id IS DISTINCT FROM OLD.approved_transcript_revision_id
     AND NEW.latest_analysis_version_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.meeting_analysis_versions mav
        WHERE mav.id = NEW.latest_analysis_version_id
          AND mav.meeting_id = NEW.id
          AND mav.transcript_revision_id = NEW.approved_transcript_revision_id
     ) THEN
    NEW.latest_analysis_version_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invalidate_stale_meeting_analysis_pointer ON public.meetings;
CREATE TRIGGER invalidate_stale_meeting_analysis_pointer
BEFORE UPDATE OF approved_transcript_revision_id ON public.meetings
FOR EACH ROW
EXECUTE FUNCTION public.invalidate_stale_meeting_analysis_pointer();
