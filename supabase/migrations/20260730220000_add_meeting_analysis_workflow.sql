-- 会议洞察不可变版本、证据关联及后台分析任务编排

CREATE TABLE public.meeting_analysis_versions (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  transcript_revision_id UUID NOT NULL REFERENCES public.transcript_revisions(id) ON DELETE RESTRICT,
  transcript_content_hash TEXT NOT NULL CHECK (transcript_content_hash ~ '^[0-9a-f]{64}$'),
  revision_no INTEGER NOT NULL CHECK (revision_no > 0),
  parent_version_id UUID REFERENCES public.meeting_analysis_versions(id) ON DELETE RESTRICT,
  processing_job_id UUID NOT NULL UNIQUE REFERENCES public.processing_jobs(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'in_review'
    CHECK (status IN ('in_review', 'approved', 'superseded')),
  summary TEXT NOT NULL CHECK (char_length(btrim(summary)) BETWEEN 1 AND 20000),
  model_id TEXT NOT NULL CHECK (char_length(btrim(model_id)) BETWEEN 1 AND 200),
  prompt_version TEXT NOT NULL CHECK (char_length(btrim(prompt_version)) BETWEEN 1 AND 100),
  schema_version TEXT NOT NULL CHECK (char_length(btrim(schema_version)) BETWEEN 1 AND 100),
  config_version TEXT NOT NULL CHECK (char_length(btrim(config_version)) BETWEEN 1 AND 100),
  model_manifest JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(model_manifest) = 'object'),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (meeting_id, revision_no),
  CHECK (
    (status = 'approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    OR (status <> 'approved' AND reviewed_by IS NULL AND reviewed_at IS NULL)
  )
);

CREATE TABLE public.meeting_analysis_items (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  analysis_version_id UUID NOT NULL REFERENCES public.meeting_analysis_versions(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 0),
  category TEXT NOT NULL CHECK (category IN (
    'requirement', 'decision', 'action_item', 'risk', 'conflict',
    'open_question', 'out_of_scope'
  )),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  description TEXT NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 4000),
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'accepted', 'excluded')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (analysis_version_id, sequence_no)
);

CREATE TABLE public.meeting_analysis_evidence (
  analysis_item_id UUID NOT NULL REFERENCES public.meeting_analysis_items(id) ON DELETE CASCADE,
  transcript_segment_id UUID NOT NULL REFERENCES public.transcript_segments(id) ON DELETE RESTRICT,
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 0),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (analysis_item_id, transcript_segment_id),
  UNIQUE (analysis_item_id, sequence_no)
);

CREATE TABLE public.meeting_analysis_job_inputs (
  processing_job_id UUID PRIMARY KEY REFERENCES public.processing_jobs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  transcript_revision_id UUID NOT NULL REFERENCES public.transcript_revisions(id) ON DELETE RESTRICT,
  transcript_content_hash TEXT NOT NULL CHECK (transcript_content_hash ~ '^[0-9a-f]{64}$'),
  model_id TEXT NOT NULL CHECK (char_length(btrim(model_id)) BETWEEN 1 AND 200),
  prompt_version TEXT NOT NULL CHECK (char_length(btrim(prompt_version)) BETWEEN 1 AND 100),
  schema_version TEXT NOT NULL CHECK (char_length(btrim(schema_version)) BETWEEN 1 AND 100),
  config_version TEXT NOT NULL CHECK (char_length(btrim(config_version)) BETWEEN 1 AND 100),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_latest_analysis_version_fk
  FOREIGN KEY (latest_analysis_version_id)
  REFERENCES public.meeting_analysis_versions(id) ON DELETE SET NULL;

CREATE INDEX idx_meeting_analysis_versions_meeting
  ON public.meeting_analysis_versions(meeting_id, revision_no DESC);
CREATE INDEX idx_meeting_analysis_versions_source
  ON public.meeting_analysis_versions(transcript_revision_id, created_at DESC);
CREATE INDEX idx_meeting_analysis_items_version
  ON public.meeting_analysis_items(analysis_version_id, sequence_no);
CREATE INDEX idx_meeting_analysis_items_review
  ON public.meeting_analysis_items(analysis_version_id, review_status, sequence_no);
CREATE INDEX idx_meeting_analysis_evidence_segment
  ON public.meeting_analysis_evidence(transcript_segment_id);
CREATE UNIQUE INDEX uq_meeting_analysis_job_input_identity
  ON public.meeting_analysis_job_inputs(
    processing_job_id, project_id, meeting_id, transcript_revision_id
  );
CREATE UNIQUE INDEX uq_meeting_analysis_source_configuration
  ON public.meeting_analysis_versions(
    meeting_id, transcript_revision_id, transcript_content_hash,
    model_id, prompt_version, schema_version, config_version
  );

ALTER TABLE public.meeting_analysis_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_analysis_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_analysis_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_analysis_job_inputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户可以查看自己项目的会议分析版本"
  ON public.meeting_analysis_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = meeting_analysis_versions.project_id
        AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以查看自己项目的会议分析项"
  ON public.meeting_analysis_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = meeting_analysis_items.project_id
        AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以查看自己项目的会议分析证据"
  ON public.meeting_analysis_evidence FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.meeting_analysis_items mai
      JOIN public.projects p ON p.id = mai.project_id
      WHERE mai.id = meeting_analysis_evidence.analysis_item_id
        AND p.created_by = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.protect_analyzed_transcript_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.meeting_analysis_versions mav
    WHERE mav.transcript_revision_id = OLD.id
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION '已用于会议分析的批准转写版本不可删除' USING ERRCODE = '55000';
    END IF;
    IF NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.meeting_id IS DISTINCT FROM OLD.meeting_id
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.full_text IS DISTINCT FROM OLD.full_text
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
      RAISE EXCEPTION '已用于会议分析的批准转写版本不可修改' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_analyzed_transcript_segment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.meeting_analysis_evidence mae
    WHERE mae.transcript_segment_id = OLD.id
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION '已用于会议分析的证据片段不可删除' USING ERRCODE = '55000';
    END IF;
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION '已用于会议分析的证据片段不可修改' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER protect_analyzed_transcript_revision
BEFORE UPDATE OR DELETE ON public.transcript_revisions
FOR EACH ROW
EXECUTE FUNCTION public.protect_analyzed_transcript_revision();

CREATE TRIGGER protect_analyzed_transcript_segment
BEFORE UPDATE OR DELETE ON public.transcript_segments
FOR EACH ROW
EXECUTE FUNCTION public.protect_analyzed_transcript_segment();

CREATE OR REPLACE FUNCTION public.start_meeting_analysis(
  p_project_id UUID,
  p_meeting_id UUID,
  p_model_id TEXT,
  p_prompt_version TEXT,
  p_schema_version TEXT,
  p_config_version TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_meeting public.meetings%ROWTYPE;
  v_revision public.transcript_revisions%ROWTYPE;
  v_job_id UUID;
  v_idempotency_key TEXT;
BEGIN
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION '仅登录用户可以启动会议分析' USING ERRCODE = '42501';
  END IF;
  IF p_model_id IS NULL OR char_length(btrim(p_model_id)) NOT BETWEEN 1 AND 200
     OR p_prompt_version IS NULL OR char_length(btrim(p_prompt_version)) NOT BETWEEN 1 AND 100
     OR p_schema_version IS NULL OR char_length(btrim(p_schema_version)) NOT BETWEEN 1 AND 100
     OR p_config_version IS NULL OR char_length(btrim(p_config_version)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION '会议分析配置无效' USING ERRCODE = '22023';
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
  IF v_meeting.status = 'archived' THEN
    RAISE EXCEPTION '归档会议不能生成会议洞察' USING ERRCODE = 'P0001';
  END IF;
  IF v_meeting.approved_transcript_revision_id IS NULL THEN
    RAISE EXCEPTION '必须先批准人工校对稿' USING ERRCODE = 'P0001';
  END IF;

  SELECT tr.* INTO v_revision
    FROM public.transcript_revisions tr
   WHERE tr.id = v_meeting.approved_transcript_revision_id
     AND tr.project_id = v_meeting.project_id
     AND tr.meeting_id = v_meeting.id
     AND tr.kind = 'human'
     AND tr.status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION '当前批准稿不是有效的人工转写版本' USING ERRCODE = '23503';
  END IF;
  IF char_length(btrim(v_revision.full_text)) = 0
     OR NOT EXISTS (
       SELECT 1 FROM public.transcript_segments ts
       WHERE ts.transcript_revision_id = v_revision.id
     ) THEN
    RAISE EXCEPTION '批准稿没有可分析的转写片段' USING ERRCODE = '23503';
  END IF;

  v_idempotency_key := 'meeting-analysis:' || pg_catalog.encode(
    extensions.digest(
      concat_ws('|', v_meeting.id::TEXT, v_revision.id::TEXT,
        v_revision.content_hash, btrim(p_model_id), btrim(p_prompt_version),
        btrim(p_schema_version), btrim(p_config_version)),
      'sha256'
    ),
    'hex'
  );

  SELECT pj.id INTO v_job_id
    FROM public.processing_jobs pj
   WHERE pj.idempotency_key = v_idempotency_key;
  IF v_job_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.processing_jobs pj
       WHERE pj.id = v_job_id
         AND pj.status = 'failed'
    ) THEN
      RAISE EXCEPTION '相同来源的会议分析任务此前已失败，请更新批准稿或分析配置后重试'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_job_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.processing_jobs pj
     WHERE pj.meeting_id = v_meeting.id
       AND pj.job_type = 'meeting_analysis'
       AND pj.status IN ('queued', 'running')
  ) THEN
    RAISE EXCEPTION '该会议已有正在运行的分析任务' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.processing_jobs (
    project_id, meeting_id, job_type, status, idempotency_key,
    provider, stage, max_attempts
  ) VALUES (
    v_meeting.project_id, v_meeting.id, 'meeting_analysis', 'queued',
    v_idempotency_key, 'deepseek', 'queued', 3
  ) RETURNING id INTO v_job_id;

  INSERT INTO public.meeting_analysis_job_inputs (
    processing_job_id, project_id, meeting_id, transcript_revision_id,
    transcript_content_hash, model_id, prompt_version, schema_version, config_version
  ) VALUES (
    v_job_id, v_meeting.project_id, v_meeting.id, v_revision.id,
    v_revision.content_hash, btrim(p_model_id), btrim(p_prompt_version),
    btrim(p_schema_version), btrim(p_config_version)
  );

  UPDATE public.meetings
     SET status = 'analyzing', updated_at = NOW()
   WHERE id = v_meeting.id;

  RETURN v_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_meeting_analysis_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 300
) RETURNS TABLE (
  job_id UUID,
  project_id UUID,
  meeting_id UUID,
  transcript_revision_id UUID,
  transcript_content_hash TEXT,
  model_id TEXT,
  prompt_version TEXT,
  schema_version TEXT,
  config_version TEXT,
  lease_token UUID,
  event_sequence BIGINT,
  attempt INTEGER,
  max_attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_job public.processing_jobs%ROWTYPE;
  v_input public.meeting_analysis_job_inputs%ROWTYPE;
  v_lease_token UUID := pg_catalog.gen_random_uuid();
  v_reclaim_same_worker BOOLEAN := false;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以领取会议分析任务' USING ERRCODE = '42501';
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
     AND pj.job_type = 'meeting_analysis'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '会议分析任务不存在' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.status IN ('succeeded', 'failed', 'cancelled') THEN
    RETURN;
  END IF;

  SELECT maji.* INTO v_input
    FROM public.meeting_analysis_job_inputs maji
   WHERE maji.processing_job_id = v_job.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '会议分析任务缺少固定输入' USING ERRCODE = '23503';
  END IF;

  IF v_job.status = 'running' AND v_job.lease_expires_at > NOW() THEN
    IF v_job.claimed_by IS DISTINCT FROM btrim(p_worker_id) THEN
      RETURN;
    END IF;
    UPDATE public.processing_jobs
       SET last_heartbeat_at = NOW(),
           lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
           updated_at = NOW()
     WHERE id = v_job.id
     RETURNING * INTO v_job;
  ELSE
    v_reclaim_same_worker := v_job.status = 'running'
      AND v_job.claimed_by = btrim(p_worker_id);

    IF NOT v_reclaim_same_worker AND v_job.attempt >= v_job.max_attempts THEN
      UPDATE public.processing_jobs
         SET status = 'failed', stage = 'failed',
             error_code = 'ATTEMPT_LIMIT',
             error_message = '会议分析任务已达到最大尝试次数',
             finished_at = NOW(), claimed_by = NULL, lease_token = NULL,
             lease_expires_at = NULL, last_heartbeat_at = NULL,
             event_sequence = event_sequence + 1, updated_at = NOW()
       WHERE id = v_job.id;
      UPDATE public.meetings
         SET status = 'review_required', updated_at = NOW()
       WHERE id = v_job.meeting_id;
      RETURN;
    END IF;

    UPDATE public.processing_jobs
       SET status = 'running', stage = 'preparing_transcript',
           progress_percent = GREATEST(progress_percent, 5),
           attempt = attempt + CASE WHEN v_reclaim_same_worker THEN 0 ELSE 1 END,
           claimed_by = btrim(p_worker_id), lease_token = v_lease_token,
           lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
           last_heartbeat_at = NOW(), started_at = COALESCE(started_at, NOW()),
           finished_at = NULL, next_poll_at = NULL,
           error_code = NULL, error_message = NULL,
           event_sequence = event_sequence + 1, updated_at = NOW()
     WHERE id = v_job.id
     RETURNING * INTO v_job;
  END IF;

  RETURN QUERY SELECT
    v_job.id, v_input.project_id, v_input.meeting_id,
    v_input.transcript_revision_id, v_input.transcript_content_hash,
    v_input.model_id, v_input.prompt_version, v_input.schema_version,
    v_input.config_version, v_job.lease_token, v_job.event_sequence,
    v_job.attempt, v_job.max_attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_meeting_analysis_job_progress(
  p_job_id UUID,
  p_lease_token UUID,
  p_stage TEXT,
  p_progress_percent INTEGER,
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
    RAISE EXCEPTION '仅后台服务可以更新会议分析任务' USING ERRCODE = '42501';
  END IF;
  IF p_stage IS NULL OR char_length(btrim(p_stage)) NOT BETWEEN 1 AND 100
     OR p_progress_percent NOT BETWEEN 0 AND 99
     OR p_lease_seconds NOT BETWEEN 30 AND 1800 THEN
    RAISE EXCEPTION '会议分析任务进度参数无效' USING ERRCODE = '22023';
  END IF;

  UPDATE public.processing_jobs
     SET stage = btrim(p_stage),
         progress_percent = GREATEST(progress_percent, p_progress_percent),
         last_heartbeat_at = NOW(),
         lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
         event_sequence = event_sequence + 1,
         updated_at = NOW()
   WHERE id = p_job_id
     AND job_type = 'meeting_analysis'
     AND status = 'running'
     AND lease_token = p_lease_token
     AND lease_expires_at > NOW()
   RETURNING event_sequence INTO v_event_sequence;
  IF NOT FOUND THEN
    RAISE EXCEPTION '会议分析任务租约无效或已过期' USING ERRCODE = '40001';
  END IF;
  RETURN v_event_sequence;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_or_retry_meeting_analysis_job(
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
#variable_conflict use_column
DECLARE
  v_job public.processing_jobs%ROWTYPE;
  v_retry_scheduled BOOLEAN;
  v_delay_seconds INTEGER;
  v_status TEXT;
  v_next_poll_at TIMESTAMP WITH TIME ZONE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以结束会议分析任务' USING ERRCODE = '42501';
  END IF;
  IF p_error_code IS NULL OR char_length(btrim(p_error_code)) NOT BETWEEN 1 AND 100
     OR p_retry_after_seconds IS NOT NULL
        AND p_retry_after_seconds NOT BETWEEN 0 AND 3600 THEN
    RAISE EXCEPTION '会议分析任务错误参数无效' USING ERRCODE = '22023';
  END IF;

  SELECT pj.* INTO v_job
    FROM public.processing_jobs pj
   WHERE pj.id = p_job_id
     AND pj.job_type = 'meeting_analysis'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '会议分析任务不存在' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.status <> 'running'
     OR v_job.lease_token IS DISTINCT FROM p_lease_token
     OR v_job.lease_expires_at <= NOW() THEN
    RAISE EXCEPTION '会议分析任务租约无效或已过期' USING ERRCODE = '40001';
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
         error_message = left(COALESCE(NULLIF(btrim(p_error_message), ''), '会议分析失败'), 1000),
         finished_at = CASE WHEN v_retry_scheduled THEN NULL ELSE NOW() END,
         next_poll_at = CASE WHEN v_retry_scheduled
           THEN NOW() + make_interval(secs => v_delay_seconds) ELSE NULL END,
         claimed_by = NULL, lease_token = NULL, lease_expires_at = NULL,
         last_heartbeat_at = NULL, event_sequence = event_sequence + 1,
         updated_at = NOW()
   WHERE id = v_job.id
   RETURNING processing_jobs.status, processing_jobs.next_poll_at
     INTO v_status, v_next_poll_at;

  UPDATE public.meetings
     SET status = CASE WHEN v_retry_scheduled THEN 'analyzing' ELSE 'review_required' END,
         updated_at = NOW()
   WHERE id = v_job.meeting_id;

  RETURN QUERY SELECT v_status, v_retry_scheduled, v_next_poll_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_meeting_analysis_job(
  p_job_id UUID,
  p_lease_token UUID,
  p_summary TEXT,
  p_model_manifest JSONB,
  p_items JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.processing_jobs%ROWTYPE;
  v_input public.meeting_analysis_job_inputs%ROWTYPE;
  v_revision public.transcript_revisions%ROWTYPE;
  v_version_id UUID;
  v_parent_version_id UUID;
  v_revision_no INTEGER;
  v_created_by UUID;
  v_item JSONB;
  v_item_id UUID;
  v_item_index INTEGER := 0;
  v_evidence JSONB;
  v_evidence_index INTEGER;
  v_segment_id UUID;
  v_evidence_count INTEGER;
  v_distinct_evidence_count INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以提交会议分析结果' USING ERRCODE = '42501';
  END IF;
  IF p_summary IS NULL OR char_length(btrim(p_summary)) NOT BETWEEN 1 AND 20000 THEN
    RAISE EXCEPTION '会议摘要长度无效' USING ERRCODE = '22023';
  END IF;
  IF p_model_manifest IS NULL OR jsonb_typeof(p_model_manifest) <> 'object' THEN
    RAISE EXCEPTION '模型清单必须为 JSON 对象' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) > 300 THEN
    RAISE EXCEPTION '会议洞察必须为不超过 300 项的 JSON 数组' USING ERRCODE = '22023';
  END IF;

  SELECT pj.* INTO v_job
    FROM public.processing_jobs pj
   WHERE pj.id = p_job_id
     AND pj.job_type = 'meeting_analysis'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '会议分析任务不存在' USING ERRCODE = 'P0002';
  END IF;

  IF v_job.status = 'succeeded' THEN
    SELECT mav.id INTO v_version_id
      FROM public.meeting_analysis_versions mav
     WHERE mav.processing_job_id = v_job.id;
    IF v_version_id IS NULL THEN
      RAISE EXCEPTION '已完成任务缺少会议分析版本' USING ERRCODE = '23503';
    END IF;
    RETURN v_version_id;
  END IF;
  IF v_job.status <> 'running'
     OR v_job.lease_token IS DISTINCT FROM p_lease_token
     OR v_job.lease_expires_at <= NOW() THEN
    RAISE EXCEPTION '会议分析任务租约无效或已过期' USING ERRCODE = '40001';
  END IF;

  SELECT maji.* INTO v_input
    FROM public.meeting_analysis_job_inputs maji
   WHERE maji.processing_job_id = v_job.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '会议分析任务缺少固定输入' USING ERRCODE = '23503';
  END IF;

  PERFORM 1
    FROM public.meetings m
   WHERE m.id = v_input.meeting_id
     AND m.project_id = v_input.project_id
     AND m.approved_transcript_revision_id = v_input.transcript_revision_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '会议当前批准稿已变化，拒绝提交旧稿分析结果' USING ERRCODE = '40001';
  END IF;

  SELECT tr.* INTO v_revision
    FROM public.transcript_revisions tr
   WHERE tr.id = v_input.transcript_revision_id
     AND tr.project_id = v_input.project_id
     AND tr.meeting_id = v_input.meeting_id
     AND tr.kind = 'human'
     AND tr.status = 'approved';
  IF NOT FOUND OR v_revision.content_hash IS DISTINCT FROM v_input.transcript_content_hash THEN
    RAISE EXCEPTION '会议分析来源转写版本无效或内容摘要已变化' USING ERRCODE = '40001';
  END IF;

  SELECT p.created_by INTO v_created_by
    FROM public.projects p
   WHERE p.id = v_input.project_id;
  IF v_created_by IS NULL THEN
    RAISE EXCEPTION '会议分析关联项目不存在' USING ERRCODE = '23503';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_input.meeting_id::TEXT, 1)
  );
  SELECT mav.id INTO v_parent_version_id
    FROM public.meeting_analysis_versions mav
   WHERE mav.meeting_id = v_input.meeting_id
   ORDER BY mav.revision_no DESC
   LIMIT 1;
  SELECT COALESCE(MAX(mav.revision_no), 0) + 1 INTO v_revision_no
    FROM public.meeting_analysis_versions mav
   WHERE mav.meeting_id = v_input.meeting_id;

  INSERT INTO public.meeting_analysis_versions (
    project_id, meeting_id, transcript_revision_id, transcript_content_hash,
    revision_no, parent_version_id, processing_job_id, status, summary,
    model_id, prompt_version, schema_version, config_version,
    model_manifest, created_by
  ) VALUES (
    v_input.project_id, v_input.meeting_id, v_input.transcript_revision_id,
    v_input.transcript_content_hash, v_revision_no, v_parent_version_id,
    v_job.id, 'in_review', btrim(p_summary), v_input.model_id,
    v_input.prompt_version, v_input.schema_version, v_input.config_version,
    p_model_manifest, v_created_by
  ) RETURNING id INTO v_version_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR v_item->>'category' NOT IN (
         'requirement', 'decision', 'action_item', 'risk', 'conflict',
         'open_question', 'out_of_scope'
       )
       OR v_item->>'title' IS NULL
       OR char_length(btrim(v_item->>'title')) NOT BETWEEN 1 AND 200
       OR v_item->>'description' IS NULL
       OR char_length(btrim(v_item->>'description')) NOT BETWEEN 1 AND 4000
       OR jsonb_typeof(v_item->'evidenceSegmentIds') <> 'array' THEN
      RAISE EXCEPTION '会议洞察项字段无效' USING ERRCODE = '22023';
    END IF;

    v_evidence_count := jsonb_array_length(v_item->'evidenceSegmentIds');
    SELECT COUNT(DISTINCT value) INTO v_distinct_evidence_count
      FROM jsonb_array_elements_text(v_item->'evidenceSegmentIds');
    IF v_evidence_count NOT BETWEEN 1 AND 20
       OR v_distinct_evidence_count <> v_evidence_count THEN
      RAISE EXCEPTION '每条会议洞察必须引用 1 到 20 个不重复证据片段' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.meeting_analysis_items (
      project_id, meeting_id, analysis_version_id, sequence_no,
      category, title, description
    ) VALUES (
      v_input.project_id, v_input.meeting_id, v_version_id, v_item_index,
      v_item->>'category', btrim(v_item->>'title'), btrim(v_item->>'description')
    ) RETURNING id INTO v_item_id;

    v_evidence_index := 0;
    FOR v_evidence IN SELECT value FROM jsonb_array_elements(v_item->'evidenceSegmentIds')
    LOOP
      BEGIN
        v_segment_id := (v_evidence #>> '{}')::UUID;
      EXCEPTION
        WHEN invalid_text_representation THEN
          RAISE EXCEPTION '会议洞察证据片段 ID 无效' USING ERRCODE = '22023';
      END;

      IF NOT EXISTS (
        SELECT 1 FROM public.transcript_segments ts
         WHERE ts.id = v_segment_id
           AND ts.project_id = v_input.project_id
           AND ts.meeting_id = v_input.meeting_id
           AND ts.transcript_revision_id = v_input.transcript_revision_id
      ) THEN
        RAISE EXCEPTION '会议洞察引用了不属于批准稿的证据片段' USING ERRCODE = '23503';
      END IF;

      INSERT INTO public.meeting_analysis_evidence (
        analysis_item_id, transcript_segment_id, sequence_no
      ) VALUES (v_item_id, v_segment_id, v_evidence_index);
      v_evidence_index := v_evidence_index + 1;
    END LOOP;

    v_item_index := v_item_index + 1;
  END LOOP;

  UPDATE public.processing_jobs
     SET status = 'succeeded', stage = 'complete', progress_percent = 100,
         error_code = NULL, error_message = NULL, finished_at = NOW(),
         next_poll_at = NULL, claimed_by = NULL, lease_token = NULL,
         lease_expires_at = NULL, last_heartbeat_at = NULL,
         event_sequence = event_sequence + 1, updated_at = NOW()
   WHERE id = v_job.id;

  UPDATE public.meetings
     SET latest_analysis_version_id = v_version_id,
         status = 'review_required', updated_at = NOW()
   WHERE id = v_input.meeting_id;

  RETURN v_version_id;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_analyzed_transcript_revision() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_analyzed_transcript_segment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_meeting_analysis(UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_meeting_analysis(UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION public.claim_meeting_analysis_job(UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_meeting_analysis_job_progress(UUID, UUID, TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_or_retry_meeting_analysis_job(UUID, UUID, TEXT, TEXT, BOOLEAN, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_meeting_analysis_job(UUID, UUID, TEXT, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_meeting_analysis_job(UUID, TEXT, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.update_meeting_analysis_job_progress(UUID, UUID, TEXT, INTEGER, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_or_retry_meeting_analysis_job(UUID, UUID, TEXT, TEXT, BOOLEAN, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_meeting_analysis_job(UUID, UUID, TEXT, JSONB, JSONB)
  TO service_role;
