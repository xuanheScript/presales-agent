-- 可恢复的售前全文分析：执行租约、单工作单元、调用账本与原子版本提交

ALTER TABLE public.agent_executions
  ADD COLUMN IF NOT EXISTS input_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS operation_id TEXT,
  ADD COLUMN IF NOT EXISTS orchestration_run_id TEXT,
  ADD COLUMN IF NOT EXISTS execution_lease_token UUID,
  ADD COLUMN IF NOT EXISTS execution_lease_generation BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leased_by TEXT,
  ADD COLUMN IF NOT EXISTS current_stage TEXT NOT NULL DEFAULT 'planning',
  ADD COLUMN IF NOT EXISTS progress_percent INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS manifest JSONB,
  ADD COLUMN IF NOT EXISTS manifest_hash TEXT,
  ADD COLUMN IF NOT EXISTS model_profile_version TEXT,
  ADD COLUMN IF NOT EXISTS prompt_bundle_hash TEXT,
  ADD COLUMN IF NOT EXISTS planned_work_units INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_work_units INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS model_call_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS input_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_tokens BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.agent_executions
  DROP CONSTRAINT IF EXISTS agent_executions_current_stage_check,
  ADD CONSTRAINT agent_executions_current_stage_check CHECK (
    current_stage IN (
      'planning', 'discovering', 'enriching',
      'calculating', 'committing', 'complete'
    )
  ),
  DROP CONSTRAINT IF EXISTS agent_executions_progress_percent_check,
  ADD CONSTRAINT agent_executions_progress_percent_check
    CHECK (progress_percent BETWEEN 0 AND 100),
  DROP CONSTRAINT IF EXISTS agent_executions_work_unit_counts_check,
  ADD CONSTRAINT agent_executions_work_unit_counts_check CHECK (
    planned_work_units >= 0
    AND completed_work_units >= 0
    AND completed_work_units <= planned_work_units
  ),
  DROP CONSTRAINT IF EXISTS agent_executions_usage_check,
  ADD CONSTRAINT agent_executions_usage_check CHECK (
    model_call_count >= 0 AND input_tokens >= 0
    AND output_tokens >= 0 AND total_tokens >= 0
  );

UPDATE public.agent_executions
   SET orchestration_run_id = NULLIF(input_data->>'orchestrationRunId', ''),
       operation_id = COALESCE(NULLIF(input_data->>'operationId', ''), id::TEXT),
       input_fingerprint = COALESCE(
         NULLIF(input_data->>'inputFingerprint', ''),
         requirement_baseline_content_hash
       ),
       execution_lease_token = CASE WHEN status = 'running'
         THEN pg_catalog.gen_random_uuid() ELSE NULL END,
       execution_lease_generation = CASE WHEN status = 'running' THEN 1 ELSE 0 END,
       leased_by = CASE WHEN status = 'running' THEN 'migration-recovery' ELSE NULL END,
       last_heartbeat_at = CASE WHEN status = 'running' THEN created_at ELSE NULL END,
       lease_expires_at = CASE WHEN status = 'running'
         THEN created_at + INTERVAL '5 minutes' ELSE NULL END;

ALTER TABLE public.agent_executions
  DROP CONSTRAINT IF EXISTS agent_executions_lease_check,
  ADD CONSTRAINT agent_executions_lease_check CHECK (
    (
      status = 'running'
      AND execution_lease_token IS NOT NULL
      AND leased_by IS NOT NULL
      AND last_heartbeat_at IS NOT NULL
      AND lease_expires_at IS NOT NULL
    )
    OR (
      status <> 'running'
      AND execution_lease_token IS NULL
      AND leased_by IS NULL
      AND lease_expires_at IS NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_executions_orchestration_run
  ON public.agent_executions(orchestration_run_id)
  WHERE orchestration_run_id IS NOT NULL
    AND status IN ('running', 'completed');
CREATE INDEX IF NOT EXISTS idx_agent_executions_active_lease
  ON public.agent_executions(status, lease_expires_at)
  WHERE status = 'running';

CREATE TABLE IF NOT EXISTS public.presales_execution_work_units (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES public.agent_executions(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage = 'full_document_discovery'),
  unit_key TEXT NOT NULL CHECK (unit_key = 'global'),
  input_hash TEXT NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (pg_catalog.jsonb_typeof(input_payload) = 'object'),
  output_payload JSONB
    CHECK (output_payload IS NULL OR pg_catalog.jsonb_typeof(output_payload) = 'object'),
  output_hash TEXT CHECK (output_hash IS NULL OR output_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'leased', 'retry_wait', 'succeeded', 'failed', 'cancelled')
  ),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  lease_token UUID,
  lease_generation BIGINT NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  leased_by TEXT,
  lease_expires_at TIMESTAMP WITH TIME ZONE,
  last_heartbeat_at TIMESTAMP WITH TIME ZONE,
  retry_at TIMESTAMP WITH TIME ZONE,
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  finish_reason TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  UNIQUE (execution_id, stage, unit_key),
  UNIQUE (id, execution_id),
  CONSTRAINT presales_work_unit_execution_project_fk
    FOREIGN KEY (execution_id, project_id)
    REFERENCES public.agent_executions(id, project_id) ON DELETE CASCADE,
  CONSTRAINT presales_work_unit_lease_check CHECK (
    (status = 'leased' AND lease_token IS NOT NULL AND lease_generation > 0
      AND leased_by IS NOT NULL AND lease_expires_at IS NOT NULL
      AND last_heartbeat_at IS NOT NULL)
    OR (status <> 'leased' AND lease_token IS NULL AND leased_by IS NULL
      AND lease_expires_at IS NULL)
  ),
  CONSTRAINT presales_work_unit_output_check CHECK (
    (status = 'succeeded' AND output_payload IS NOT NULL AND output_hash IS NOT NULL
      AND finish_reason = 'stop' AND completed_at IS NOT NULL)
    OR status <> 'succeeded'
  )
);

CREATE INDEX IF NOT EXISTS idx_presales_work_units_ready
  ON public.presales_execution_work_units(execution_id, status, retry_at, created_at);
CREATE INDEX IF NOT EXISTS idx_presales_work_units_lease
  ON public.presales_execution_work_units(status, lease_expires_at)
  WHERE status = 'leased';

CREATE TABLE IF NOT EXISTS public.agent_execution_model_calls (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  execution_id UUID NOT NULL,
  work_unit_id UUID,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  call_key TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage = 'full_document_discovery'),
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  configured_model_id TEXT NOT NULL,
  response_model_id TEXT,
  response_id TEXT,
  model_profile_version TEXT NOT NULL,
  provider_options_hash TEXT NOT NULL CHECK (provider_options_hash ~ '^[0-9a-f]{64}$'),
  finish_reason TEXT NOT NULL,
  raw_finish_reason TEXT,
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens BIGINT NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  empty_output BOOLEAN NOT NULL DEFAULT FALSE,
  structured_output_error BOOLEAN NOT NULL DEFAULT FALSE,
  provider_metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (execution_id, call_key),
  CONSTRAINT presales_model_call_execution_project_fk
    FOREIGN KEY (execution_id, project_id)
    REFERENCES public.agent_executions(id, project_id) ON DELETE CASCADE,
  CONSTRAINT presales_model_call_work_unit_fk
    FOREIGN KEY (work_unit_id, execution_id)
    REFERENCES public.presales_execution_work_units(id, execution_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_execution_model_calls_execution
  ON public.agent_execution_model_calls(execution_id, stage, created_at);

ALTER TABLE public.presales_execution_work_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_execution_model_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view presales execution work units"
  ON public.presales_execution_work_units FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = presales_execution_work_units.project_id
       AND p.created_by = auth.uid()
  ));
CREATE POLICY "Owners can view presales execution model calls"
  ON public.agent_execution_model_calls FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = agent_execution_model_calls.project_id
       AND p.created_by = auth.uid()
  ));

REVOKE ALL ON TABLE public.presales_execution_work_units FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.agent_execution_model_calls FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.presales_execution_work_units TO authenticated, service_role;
GRANT SELECT ON TABLE public.agent_execution_model_calls TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.initialize_presales_execution_plan(
  p_actor_user_id UUID,
  p_execution_id UUID,
  p_manifest JSONB,
  p_manifest_hash TEXT,
  p_model_profile_version TEXT,
  p_prompt_bundle_hash TEXT,
  p_discovery_input JSONB,
  p_discovery_input_hash TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_execution public.agent_executions%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以初始化售前执行计划' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.jsonb_typeof(p_manifest) <> 'object'
     OR pg_catalog.jsonb_typeof(p_discovery_input) <> 'object'
     OR NULLIF(btrim(p_manifest_hash), '') IS NULL
     OR p_manifest_hash !~ '^[0-9a-f]{64}$'
     OR NULLIF(btrim(p_model_profile_version), '') IS NULL
     OR NULLIF(btrim(p_prompt_bundle_hash), '') IS NULL
     OR p_prompt_bundle_hash !~ '^[0-9a-f]{64}$'
     OR NULLIF(btrim(p_discovery_input_hash), '') IS NULL
     OR p_discovery_input_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION '售前执行计划参数无效' USING ERRCODE = '22023';
  END IF;

  SELECT ae.* INTO v_execution
    FROM public.agent_executions ae
   WHERE ae.id = p_execution_id
     AND ae.requested_by = p_actor_user_id
     AND ae.status = 'running'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '执行不存在、无权限或已结束' USING ERRCODE = 'P0002';
  END IF;
  IF p_manifest->>'baselineId' IS DISTINCT FROM v_execution.requirement_baseline_id::TEXT
     OR p_manifest->>'contentHash' IS DISTINCT FROM v_execution.requirement_baseline_content_hash THEN
    RAISE EXCEPTION '执行计划与执行绑定的需求基线不一致' USING ERRCODE = '40001';
  END IF;

  IF v_execution.manifest_hash IS NOT NULL THEN
    IF v_execution.manifest_hash IS DISTINCT FROM btrim(p_manifest_hash)
       OR v_execution.manifest IS DISTINCT FROM p_manifest
       OR v_execution.model_profile_version IS DISTINCT FROM btrim(p_model_profile_version)
       OR v_execution.prompt_bundle_hash IS DISTINCT FROM btrim(p_prompt_bundle_hash)
       OR NOT EXISTS (
         SELECT 1 FROM public.presales_execution_work_units wu
          WHERE wu.execution_id = v_execution.id
            AND wu.stage = 'full_document_discovery'
            AND wu.unit_key = 'global'
            AND wu.input_hash = btrim(p_discovery_input_hash)
            AND wu.input_payload = p_discovery_input
       )
       OR (SELECT COUNT(*) FROM public.presales_execution_work_units wu
            WHERE wu.execution_id = v_execution.id) <> 1 THEN
      RAISE EXCEPTION '执行计划与已冻结全文分析输入冲突' USING ERRCODE = '40001';
    END IF;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.presales_execution_work_units wu
     WHERE wu.execution_id = v_execution.id
  ) THEN
    RAISE EXCEPTION '未冻结执行已包含工作单元' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.presales_execution_work_units (
    execution_id, project_id, stage, unit_key,
    input_hash, input_payload, status
  ) VALUES (
    v_execution.id, v_execution.project_id, 'full_document_discovery', 'global',
    btrim(p_discovery_input_hash), p_discovery_input, 'pending'
  );

  UPDATE public.agent_executions
     SET manifest = p_manifest,
         manifest_hash = btrim(p_manifest_hash),
         model_profile_version = btrim(p_model_profile_version),
         prompt_bundle_hash = btrim(p_prompt_bundle_hash),
         planned_work_units = 1,
         completed_work_units = 0,
         current_stage = 'discovering',
         progress_percent = GREATEST(progress_percent, 5),
         last_heartbeat_at = NOW(),
         lease_expires_at = NOW() + INTERVAL '5 minutes'
   WHERE id = v_execution.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_presales_execution(
  p_actor_user_id UUID,
  p_execution_id UUID,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 300
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_execution public.agent_executions%ROWTYPE;
  v_token UUID := pg_catalog.gen_random_uuid();
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以领取售前执行' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_worker_id), '') IS NULL
     OR p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION '领取售前执行参数无效' USING ERRCODE = '22023';
  END IF;

  SELECT ae.* INTO v_execution
    FROM public.agent_executions ae
   WHERE ae.id = p_execution_id
     AND ae.requested_by = p_actor_user_id
     AND ae.status = 'running'
     AND (ae.leased_by = btrim(p_worker_id) OR ae.lease_expires_at <= NOW())
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '执行租约由其他 worker 持有或执行已结束' USING ERRCODE = '40001';
  END IF;

  UPDATE public.agent_executions
     SET execution_lease_token = v_token,
         execution_lease_generation = execution_lease_generation + 1,
         leased_by = btrim(p_worker_id),
         last_heartbeat_at = NOW(),
         lease_expires_at = NOW() + pg_catalog.make_interval(secs => p_lease_seconds)
   WHERE id = v_execution.id;

  RETURN pg_catalog.jsonb_build_object(
    'executionId', v_execution.id,
    'leaseToken', v_token,
    'leaseGeneration', v_execution.execution_lease_generation + 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_presales_execution(
  p_actor_user_id UUID,
  p_execution_id UUID,
  p_lease_token UUID,
  p_lease_generation BIGINT,
  p_worker_id TEXT,
  p_stage TEXT,
  p_progress_percent INTEGER,
  p_lease_seconds INTEGER DEFAULT 300
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以更新售前分析心跳' USING ERRCODE = '42501';
  END IF;
  IF p_stage NOT IN (
    'planning', 'discovering', 'enriching',
    'calculating', 'committing', 'complete'
  ) OR p_progress_percent NOT BETWEEN 0 AND 100
     OR p_lease_seconds NOT BETWEEN 60 AND 3600
     OR NULLIF(btrim(p_worker_id), '') IS NULL THEN
    RAISE EXCEPTION '售前分析进度参数无效' USING ERRCODE = '22023';
  END IF;

  UPDATE public.agent_executions ae
     SET current_stage = p_stage,
         progress_percent = GREATEST(ae.progress_percent, p_progress_percent),
         last_heartbeat_at = NOW(),
         lease_expires_at = NOW() + pg_catalog.make_interval(secs => p_lease_seconds)
   WHERE ae.id = p_execution_id
     AND ae.requested_by = p_actor_user_id
     AND ae.status = 'running'
     AND ae.execution_lease_token = p_lease_token
     AND ae.execution_lease_generation = p_lease_generation
     AND ae.leased_by = btrim(p_worker_id)
     AND ae.lease_expires_at > NOW();
  IF NOT FOUND THEN
    RAISE EXCEPTION '执行租约已失效' USING ERRCODE = '40001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_presales_work_unit(
  p_actor_user_id UUID,
  p_execution_id UUID,
  p_execution_lease_token UUID,
  p_execution_lease_generation BIGINT,
  p_stage TEXT,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 300
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_unit public.presales_execution_work_units%ROWTYPE;
  v_token UUID := pg_catalog.gen_random_uuid();
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以领取售前工作单元' USING ERRCODE = '42501';
  END IF;
  IF p_stage IS DISTINCT FROM 'full_document_discovery'
     OR NULLIF(btrim(p_worker_id), '') IS NULL
     OR p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION '领取售前工作单元参数无效' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.agent_executions ae
   WHERE ae.id = p_execution_id
     AND ae.requested_by = p_actor_user_id
     AND ae.status = 'running'
     AND ae.execution_lease_token = p_execution_lease_token
     AND ae.execution_lease_generation = p_execution_lease_generation
     AND ae.leased_by = btrim(p_worker_id)
     AND ae.lease_expires_at > NOW()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '领取工作单元时执行租约已失效' USING ERRCODE = '40001';
  END IF;

  SELECT wu.* INTO v_unit
    FROM public.presales_execution_work_units wu
   WHERE wu.execution_id = p_execution_id
     AND wu.stage = 'full_document_discovery'
     AND wu.unit_key = 'global'
     AND (
       wu.status = 'pending'
       OR (wu.status = 'retry_wait' AND wu.attempt < wu.max_attempts
           AND COALESCE(wu.retry_at, NOW()) <= NOW())
       OR (wu.status = 'leased' AND wu.attempt < wu.max_attempts
           AND wu.lease_expires_at < NOW())
     )
   FOR UPDATE OF wu SKIP LOCKED
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.presales_execution_work_units
     SET status = 'leased', attempt = attempt + 1, lease_token = v_token,
         lease_generation = lease_generation + 1,
         leased_by = btrim(p_worker_id),
         lease_expires_at = NOW() + pg_catalog.make_interval(secs => p_lease_seconds),
         last_heartbeat_at = NOW(), updated_at = NOW(), retry_at = NULL,
         error_code = NULL, error_message = NULL
   WHERE id = v_unit.id;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_unit.id,
    'unitKey', v_unit.unit_key,
    'inputHash', v_unit.input_hash,
    'input', v_unit.input_payload,
    'leaseToken', v_token,
    'leaseGeneration', v_unit.lease_generation + 1,
    'attempt', v_unit.attempt + 1,
    'maxAttempts', v_unit.max_attempts
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_presales_work_unit(
  p_execution_id UUID,
  p_execution_lease_token UUID,
  p_execution_lease_generation BIGINT,
  p_work_unit_id UUID,
  p_lease_token UUID,
  p_lease_generation BIGINT,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 300
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以更新工作单元心跳' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_worker_id), '') IS NULL
     OR p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION '工作单元心跳参数无效' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.agent_executions ae
   WHERE ae.id = p_execution_id
     AND ae.status = 'running'
     AND ae.execution_lease_token = p_execution_lease_token
     AND ae.execution_lease_generation = p_execution_lease_generation
     AND ae.leased_by = btrim(p_worker_id)
     AND ae.lease_expires_at > NOW()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '更新工作单元心跳时执行租约已失效' USING ERRCODE = '40001';
  END IF;

  UPDATE public.presales_execution_work_units wu
     SET last_heartbeat_at = NOW(),
         lease_expires_at = NOW() + pg_catalog.make_interval(secs => p_lease_seconds),
         updated_at = NOW()
   WHERE wu.id = p_work_unit_id
     AND wu.execution_id = p_execution_id
     AND wu.stage = 'full_document_discovery'
     AND wu.unit_key = 'global'
     AND wu.status = 'leased'
     AND wu.lease_token = p_lease_token
     AND wu.lease_generation = p_lease_generation
     AND wu.leased_by = btrim(p_worker_id)
     AND wu.lease_expires_at > NOW();
  IF NOT FOUND THEN
    RAISE EXCEPTION '工作单元租约已失效' USING ERRCODE = '40001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_presales_model_call(
  p_execution_id UUID,
  p_execution_lease_token UUID,
  p_execution_lease_generation BIGINT,
  p_worker_id TEXT,
  p_work_unit_id UUID,
  p_work_unit_lease_token UUID,
  p_work_unit_lease_generation BIGINT,
  p_project_id UUID,
  p_call_key TEXT,
  p_stage TEXT,
  p_attempt INTEGER,
  p_configured_model_id TEXT,
  p_response_model_id TEXT,
  p_response_id TEXT,
  p_model_profile_version TEXT,
  p_provider_options_hash TEXT,
  p_finish_reason TEXT,
  p_raw_finish_reason TEXT,
  p_input_tokens BIGINT,
  p_output_tokens BIGINT,
  p_total_tokens BIGINT,
  p_latency_ms INTEGER,
  p_empty_output BOOLEAN,
  p_structured_output_error BOOLEAN,
  p_provider_metadata JSONB DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_execution public.agent_executions%ROWTYPE;
  v_inserted INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以记录模型调用' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_call_key), '') IS NULL
     OR p_stage IS DISTINCT FROM 'full_document_discovery'
     OR NULLIF(btrim(p_configured_model_id), '') IS NULL
     OR NULLIF(btrim(p_model_profile_version), '') IS NULL
     OR NULLIF(btrim(p_provider_options_hash), '') IS NULL
     OR p_provider_options_hash !~ '^[0-9a-f]{64}$'
     OR NULLIF(btrim(p_finish_reason), '') IS NULL
     OR p_attempt < 1
     OR LEAST(p_input_tokens, p_output_tokens, p_total_tokens, p_latency_ms) < 0
     OR (p_provider_metadata IS NOT NULL
       AND pg_catalog.jsonb_typeof(p_provider_metadata) <> 'object') THEN
    RAISE EXCEPTION '模型调用指标无效' USING ERRCODE = '22023';
  END IF;

  SELECT ae.* INTO v_execution
    FROM public.agent_executions ae
   WHERE ae.id = p_execution_id
     AND ae.project_id = p_project_id
     AND ae.status = 'running'
     AND ae.execution_lease_token = p_execution_lease_token
     AND ae.execution_lease_generation = p_execution_lease_generation
     AND ae.leased_by = btrim(p_worker_id)
     AND ae.lease_expires_at > NOW()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '记录模型调用时执行租约已失效' USING ERRCODE = '40001';
  END IF;
  IF p_work_unit_id IS NULL
     OR p_work_unit_lease_token IS NULL
     OR p_work_unit_lease_generation IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.presales_execution_work_units wu
        WHERE wu.id = p_work_unit_id
          AND wu.execution_id = p_execution_id
          AND wu.stage = 'full_document_discovery'
          AND wu.unit_key = 'global'
          AND wu.status = 'leased'
          AND wu.lease_token = p_work_unit_lease_token
          AND wu.lease_generation = p_work_unit_lease_generation
          AND wu.leased_by = btrim(p_worker_id)
          AND wu.lease_expires_at > NOW()
     ) THEN
    RAISE EXCEPTION '模型调用关联工作单元无效' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.agent_execution_model_calls (
    execution_id, work_unit_id, project_id, call_key, stage, attempt,
    configured_model_id, response_model_id, response_id, model_profile_version,
    provider_options_hash, finish_reason, raw_finish_reason,
    input_tokens, output_tokens, total_tokens, latency_ms,
    empty_output, structured_output_error, provider_metadata
  ) VALUES (
    p_execution_id, p_work_unit_id, p_project_id, btrim(p_call_key), p_stage, p_attempt,
    btrim(p_configured_model_id), NULLIF(btrim(p_response_model_id), ''),
    NULLIF(btrim(p_response_id), ''), btrim(p_model_profile_version),
    btrim(p_provider_options_hash), btrim(p_finish_reason),
    NULLIF(btrim(p_raw_finish_reason), ''), p_input_tokens, p_output_tokens,
    p_total_tokens, p_latency_ms, p_empty_output, p_structured_output_error,
    p_provider_metadata
  ) ON CONFLICT (execution_id, call_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 1 THEN
    UPDATE public.agent_executions
       SET model_call_count = model_call_count + 1,
           input_tokens = input_tokens + p_input_tokens,
           output_tokens = output_tokens + p_output_tokens,
           total_tokens = total_tokens + p_total_tokens
     WHERE id = p_execution_id
       AND status = 'running'
       AND execution_lease_token = p_execution_lease_token
       AND execution_lease_generation = p_execution_lease_generation
       AND leased_by = btrim(p_worker_id)
       AND lease_expires_at > NOW();
    IF NOT FOUND THEN
      RAISE EXCEPTION '模型调用关联执行无效' USING ERRCODE = '23503';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_presales_work_unit(
  p_execution_id UUID,
  p_execution_lease_token UUID,
  p_execution_lease_generation BIGINT,
  p_work_unit_id UUID,
  p_lease_token UUID,
  p_lease_generation BIGINT,
  p_worker_id TEXT,
  p_output_payload JSONB,
  p_output_hash TEXT,
  p_input_tokens BIGINT DEFAULT 0,
  p_output_tokens BIGINT DEFAULT 0,
  p_latency_ms INTEGER DEFAULT 0,
  p_finish_reason TEXT DEFAULT 'stop'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以完成工作单元' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.jsonb_typeof(p_output_payload) <> 'object'
     OR pg_catalog.jsonb_typeof(p_output_payload->'analysis') <> 'object'
     OR pg_catalog.jsonb_typeof(p_output_payload->'functions') <> 'array'
     OR pg_catalog.jsonb_array_length(p_output_payload->'functions') < 1
     OR NULLIF(btrim(p_output_hash), '') IS NULL
     OR p_output_hash !~ '^[0-9a-f]{64}$'
     OR p_finish_reason IS DISTINCT FROM 'stop'
     OR LEAST(p_input_tokens, p_output_tokens, p_latency_ms) < 0 THEN
    RAISE EXCEPTION '全文分析工作单元输出无效或未完整结束' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.agent_executions ae
   WHERE ae.id = p_execution_id
     AND ae.status = 'running'
     AND ae.execution_lease_token = p_execution_lease_token
     AND ae.execution_lease_generation = p_execution_lease_generation
     AND ae.leased_by = btrim(p_worker_id)
     AND ae.lease_expires_at > NOW()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '执行租约已失效' USING ERRCODE = '40001';
  END IF;

  UPDATE public.presales_execution_work_units wu
     SET status = 'succeeded', output_payload = p_output_payload,
         output_hash = btrim(p_output_hash), input_tokens = p_input_tokens,
         output_tokens = p_output_tokens, latency_ms = p_latency_ms,
         finish_reason = p_finish_reason, lease_token = NULL, leased_by = NULL,
         lease_expires_at = NULL, completed_at = NOW(), updated_at = NOW()
   WHERE wu.id = p_work_unit_id
     AND wu.execution_id = p_execution_id
     AND wu.stage = 'full_document_discovery'
     AND wu.unit_key = 'global'
     AND wu.status = 'leased'
     AND wu.lease_token = p_lease_token
     AND wu.lease_generation = p_lease_generation
     AND wu.leased_by = btrim(p_worker_id)
     AND wu.lease_expires_at > NOW();
  IF NOT FOUND THEN
    RAISE EXCEPTION '工作单元租约已失效' USING ERRCODE = '40001';
  END IF;

  UPDATE public.agent_executions
     SET completed_work_units = 1,
         current_stage = 'enriching',
         progress_percent = GREATEST(progress_percent, 55),
         last_heartbeat_at = NOW(),
         lease_expires_at = NOW() + INTERVAL '5 minutes'
   WHERE id = p_execution_id
     AND status = 'running'
     AND execution_lease_token = p_execution_lease_token
     AND execution_lease_generation = p_execution_lease_generation
     AND leased_by = btrim(p_worker_id)
     AND lease_expires_at > NOW()
     AND planned_work_units = 1
     AND completed_work_units = 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION '执行计划计数无效或执行已结束' USING ERRCODE = '40001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_presales_work_unit(
  p_execution_id UUID,
  p_execution_lease_token UUID,
  p_execution_lease_generation BIGINT,
  p_work_unit_id UUID,
  p_lease_token UUID,
  p_lease_generation BIGINT,
  p_worker_id TEXT,
  p_error_code TEXT,
  p_error_message TEXT,
  p_retryable BOOLEAN,
  p_retry_delay_seconds INTEGER DEFAULT 30
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
  v_became_terminal BOOLEAN;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以结束工作单元' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_worker_id), '') IS NULL
     OR NULLIF(btrim(p_error_code), '') IS NULL
     OR NULLIF(btrim(p_error_message), '') IS NULL
     OR p_retryable IS NULL
     OR p_retry_delay_seconds < 1 THEN
    RAISE EXCEPTION '工作单元失败参数无效' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.agent_executions ae
   WHERE ae.id = p_execution_id
     AND ae.status = 'running'
     AND ae.execution_lease_token = p_execution_lease_token
     AND ae.execution_lease_generation = p_execution_lease_generation
     AND ae.leased_by = btrim(p_worker_id)
     AND ae.lease_expires_at > NOW()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '结束工作单元时执行租约已失效' USING ERRCODE = '40001';
  END IF;

  UPDATE public.presales_execution_work_units wu
     SET status = CASE
           WHEN p_retryable AND attempt < max_attempts THEN 'retry_wait'
           ELSE 'failed'
         END,
         retry_at = CASE
           WHEN p_retryable AND attempt < max_attempts
             THEN NOW() + pg_catalog.make_interval(secs => p_retry_delay_seconds)
           ELSE NULL
         END,
         error_code = btrim(p_error_code), error_message = p_error_message,
         lease_token = NULL, leased_by = NULL, lease_expires_at = NULL,
         completed_at = CASE
           WHEN p_retryable AND attempt < max_attempts THEN NULL ELSE NOW()
         END,
         updated_at = NOW()
   WHERE wu.id = p_work_unit_id
     AND wu.execution_id = p_execution_id
     AND wu.stage = 'full_document_discovery'
     AND wu.unit_key = 'global'
     AND wu.status = 'leased'
     AND wu.lease_token = p_lease_token
     AND wu.lease_generation = p_lease_generation
     AND wu.leased_by = btrim(p_worker_id)
     AND wu.lease_expires_at > NOW()
   RETURNING wu.status, wu.status = 'failed' INTO v_status, v_became_terminal;
  IF NOT FOUND THEN
    RAISE EXCEPTION '工作单元租约已失效' USING ERRCODE = '40001';
  END IF;

  IF v_became_terminal THEN
    UPDATE public.agent_executions ae
       SET completed_work_units = 1,
           last_heartbeat_at = NOW(),
           lease_expires_at = NOW() + INTERVAL '5 minutes'
     WHERE ae.id = p_execution_id
       AND ae.status = 'running'
       AND ae.execution_lease_token = p_execution_lease_token
       AND ae.execution_lease_generation = p_execution_lease_generation
       AND ae.leased_by = btrim(p_worker_id)
       AND ae.lease_expires_at > NOW()
       AND ae.planned_work_units = 1
       AND ae.completed_work_units = 0;
    IF NOT FOUND THEN
      RAISE EXCEPTION '执行计划计数无效或执行已结束' USING ERRCODE = '40001';
    END IF;
  END IF;
  RETURN v_status;
END;
$$;

-- 启动时只按租约恢复执行，健康长任务不会因创建时间较早而被终止。
CREATE OR REPLACE FUNCTION public.begin_presales_execution(
  p_actor_user_id UUID,
  p_project_id UUID,
  p_requirement_baseline_id UUID,
  p_agent_type TEXT,
  p_input_data JSONB,
  p_system_config JSONB,
  p_model_id TEXT,
  p_workflow_version TEXT,
  p_prompt_versions JSONB,
  p_output_schema_version TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_execution_id UUID;
  v_project public.projects%ROWTYPE;
  v_baseline public.requirement_baselines%ROWTYPE;
  v_run_id TEXT := NULLIF(btrim(COALESCE(p_input_data->>'orchestrationRunId', '')), '');
  v_worker_id TEXT := COALESCE(
    NULLIF(btrim(COALESCE(p_input_data->>'workerId', '')), ''), v_run_id, 'inline'
  );
  v_execution_lease_token UUID := pg_catalog.gen_random_uuid();
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以启动售前分析' USING ERRCODE = '42501';
  END IF;
  IF p_actor_user_id IS NULL
     OR pg_catalog.jsonb_typeof(COALESCE(p_input_data, '{}'::jsonb)) <> 'object'
     OR pg_catalog.jsonb_typeof(p_system_config) <> 'object'
     OR pg_catalog.jsonb_typeof(p_prompt_versions) <> 'object'
     OR NULLIF(btrim(p_model_id), '') IS NULL
     OR NULLIF(btrim(p_workflow_version), '') IS NULL
     OR NULLIF(btrim(p_output_schema_version), '') IS NULL THEN
    RAISE EXCEPTION '执行输入快照或版本信息无效' USING ERRCODE = '22023';
  END IF;

  SELECT p.* INTO v_project FROM public.projects p
   WHERE p.id = p_project_id AND p.created_by = p_actor_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '项目不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;
  IF v_project.status = 'archived' THEN
    RAISE EXCEPTION '归档项目不能执行分析' USING ERRCODE = 'P0001';
  END IF;
  IF v_project.current_requirement_baseline_id IS DISTINCT FROM p_requirement_baseline_id THEN
    RAISE EXCEPTION '请求的需求基线不是项目当前已确认基线' USING ERRCODE = '40001';
  END IF;

  SELECT rb.* INTO v_baseline FROM public.requirement_baselines rb
   WHERE rb.id = p_requirement_baseline_id AND rb.project_id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '需求基线不存在或与项目不匹配' USING ERRCODE = '23503';
  END IF;

  IF v_run_id IS NOT NULL THEN
    SELECT ae.id INTO v_execution_id FROM public.agent_executions ae
     WHERE ae.orchestration_run_id = v_run_id
       AND ae.project_id = p_project_id
       AND ae.requested_by = p_actor_user_id
       AND ae.requirement_baseline_id = p_requirement_baseline_id
       AND ae.requirement_baseline_content_hash = v_baseline.content_hash
       AND ae.agent_type = p_agent_type
       AND ae.input_fingerprint = COALESCE(
         NULLIF(btrim(p_input_data->>'inputFingerprint'), ''), v_baseline.content_hash
       )
       AND ae.operation_id = COALESCE(
         NULLIF(btrim(p_input_data->>'operationId'), ''), v_run_id
       )
       AND ae.input_data IS NOT DISTINCT FROM (
         COALESCE(p_input_data, '{}'::jsonb) || pg_catalog.jsonb_build_object(
           'previousProjectStatus', ae.input_data->>'previousProjectStatus',
           'expectedEstimateVersionId', ae.input_data->'expectedEstimateVersionId',
           'requirementBaselineId', v_baseline.id,
           'requirementBaselineRevision', v_baseline.revision_no,
           'requirementBaselineContentHash', v_baseline.content_hash
         )
       )
       AND ae.system_config_snapshot IS NOT DISTINCT FROM p_system_config
       AND ae.model_id = btrim(p_model_id)
       AND ae.workflow_version = btrim(p_workflow_version)
       AND ae.prompt_versions IS NOT DISTINCT FROM p_prompt_versions
       AND ae.output_schema_version = btrim(p_output_schema_version)
       AND ae.status IN ('running', 'completed')
     LIMIT 1;
    IF FOUND THEN
      UPDATE public.agent_executions
         SET execution_lease_token = v_execution_lease_token,
             execution_lease_generation = execution_lease_generation + 1,
             leased_by = v_worker_id,
             last_heartbeat_at = NOW(),
             lease_expires_at = NOW() + INTERVAL '5 minutes'
       WHERE id = v_execution_id
         AND status = 'running'
         AND lease_expires_at <= NOW();
      RETURN v_execution_id;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.agent_executions ae
       WHERE ae.orchestration_run_id = v_run_id
         AND ae.status IN ('running', 'completed')
    ) THEN
      RAISE EXCEPTION '相同编排运行 ID 的不可变执行输入不一致' USING ERRCODE = '40001';
    END IF;
  END IF;

  INSERT INTO public.agent_executions (
    project_id, requirement_id, requirement_baseline_id,
    requirement_baseline_content_hash, agent_type, input_data, status,
    system_config_snapshot, model_id, workflow_version, prompt_versions,
    output_schema_version, requested_by, input_fingerprint, operation_id,
    orchestration_run_id, execution_lease_token, execution_lease_generation,
    leased_by, current_stage, progress_percent,
    last_heartbeat_at, lease_expires_at
  ) VALUES (
    p_project_id, v_baseline.source_requirement_id, v_baseline.id,
    v_baseline.content_hash, p_agent_type,
    COALESCE(p_input_data, '{}'::jsonb) || pg_catalog.jsonb_build_object(
      'previousProjectStatus', v_project.status,
      'expectedEstimateVersionId', v_project.latest_estimate_version_id,
      'requirementBaselineId', v_baseline.id,
      'requirementBaselineRevision', v_baseline.revision_no,
      'requirementBaselineContentHash', v_baseline.content_hash
    ),
    'running', p_system_config, btrim(p_model_id), btrim(p_workflow_version),
    p_prompt_versions, btrim(p_output_schema_version), p_actor_user_id,
    COALESCE(NULLIF(btrim(p_input_data->>'inputFingerprint'), ''), v_baseline.content_hash),
    COALESCE(
      NULLIF(btrim(p_input_data->>'operationId'), ''),
      v_run_id,
      pg_catalog.gen_random_uuid()::TEXT
    ),
    v_run_id, v_execution_lease_token, 1, v_worker_id,
    'planning', 0, NOW(), NOW() + INTERVAL '5 minutes'
  ) RETURNING id INTO v_execution_id;

  UPDATE public.projects SET status = 'analyzing' WHERE id = p_project_id;
  RETURN v_execution_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_agent_execution_provenance()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.requirement_id IS DISTINCT FROM OLD.requirement_id
     OR NEW.requirement_baseline_id IS DISTINCT FROM OLD.requirement_baseline_id
     OR NEW.requirement_baseline_content_hash IS DISTINCT FROM OLD.requirement_baseline_content_hash
     OR NEW.agent_type IS DISTINCT FROM OLD.agent_type
     OR NEW.input_data IS DISTINCT FROM OLD.input_data
     OR NEW.system_config_snapshot IS DISTINCT FROM OLD.system_config_snapshot
     OR NEW.model_id IS DISTINCT FROM OLD.model_id
     OR NEW.workflow_version IS DISTINCT FROM OLD.workflow_version
     OR NEW.prompt_versions IS DISTINCT FROM OLD.prompt_versions
     OR NEW.output_schema_version IS DISTINCT FROM OLD.output_schema_version
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.input_fingerprint IS DISTINCT FROM OLD.input_fingerprint
     OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
     OR NEW.orchestration_run_id IS DISTINCT FROM OLD.orchestration_run_id
     OR (OLD.manifest_hash IS NOT NULL AND NEW.manifest IS DISTINCT FROM OLD.manifest)
     OR (OLD.manifest_hash IS NOT NULL AND NEW.manifest_hash IS DISTINCT FROM OLD.manifest_hash)
     OR (OLD.model_profile_version IS NOT NULL
       AND NEW.model_profile_version IS DISTINCT FROM OLD.model_profile_version)
     OR (OLD.prompt_bundle_hash IS NOT NULL
       AND NEW.prompt_bundle_hash IS DISTINCT FROM OLD.prompt_bundle_hash)
     OR (
       NEW.estimate_version_id IS DISTINCT FROM OLD.estimate_version_id
       AND NOT (
         OLD.estimate_version_id IS NULL
         AND NEW.estimate_version_id IS NOT NULL
         AND NEW.status = 'completed'
         AND EXISTS (
           SELECT 1 FROM public.estimate_versions ev
            WHERE ev.id = NEW.estimate_version_id
              AND ev.project_id = NEW.project_id
              AND ev.agent_execution_id = NEW.id
         )
       )
     )
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Agent 执行输入与来源信息不可修改' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- 健康长任务依据租约和心跳判定是否失联。
CREATE OR REPLACE FUNCTION public.reconcile_stale_presales_executions(
  p_stale_after_seconds INTEGER DEFAULT 900,
  p_batch_size INTEGER DEFAULT 100
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stale_execution RECORD;
  v_previous_status TEXT;
  v_reconciled INTEGER := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以巡检售前执行' USING ERRCODE = '42501';
  END IF;
  IF p_stale_after_seconds < 60 OR p_stale_after_seconds > 86400
     OR p_batch_size < 1 OR p_batch_size > 1000 THEN
    RAISE EXCEPTION '巡检参数无效' USING ERRCODE = '22023';
  END IF;

  FOR v_stale_execution IN
    SELECT ae.id, ae.project_id, ae.created_at, ae.input_data
      FROM public.agent_executions ae
     WHERE ae.agent_type = 'presales_estimation'
       AND ae.status = 'running'
       AND ae.lease_expires_at < NOW()
       AND ae.last_heartbeat_at < NOW() - pg_catalog.make_interval(secs => p_stale_after_seconds)
     ORDER BY ae.last_heartbeat_at
     LIMIT p_batch_size
  LOOP
    PERFORM 1 FROM public.projects p
     WHERE p.id = v_stale_execution.project_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    PERFORM 1 FROM public.agent_executions ae
     WHERE ae.id = v_stale_execution.id
       AND ae.status = 'running'
       AND ae.lease_expires_at < NOW()
     FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;

    UPDATE public.presales_execution_work_units
       SET status = CASE WHEN attempt < max_attempts THEN 'retry_wait' ELSE 'failed' END,
           retry_at = CASE WHEN attempt < max_attempts THEN NOW() ELSE NULL END,
           error_code = 'LEASE_EXPIRED',
           error_message = '工作单元租约过期，等待相同 execution 重试复用',
           lease_token = NULL, leased_by = NULL, lease_expires_at = NULL,
           updated_at = NOW(),
           completed_at = CASE WHEN attempt >= max_attempts THEN NOW() ELSE NULL END
     WHERE execution_id = v_stale_execution.id
       AND status = 'leased';

    IF EXISTS (
      SELECT 1 FROM public.presales_execution_work_units wu
       WHERE wu.execution_id = v_stale_execution.id
         AND wu.status IN ('pending', 'retry_wait')
    ) THEN
      UPDATE public.agent_executions
         SET execution_lease_token = pg_catalog.gen_random_uuid(),
             execution_lease_generation = execution_lease_generation + 1,
             leased_by = 'reconcile-recovery',
             last_heartbeat_at = NOW(),
             lease_expires_at = NOW(),
             completed_work_units = 0
       WHERE id = v_stale_execution.id AND status = 'running';
      v_reconciled := v_reconciled + 1;
      CONTINUE;
    END IF;

    UPDATE public.agent_executions
       SET status = 'timed_out',
           error_message = COALESCE(error_message, '后台巡检发现执行租约过期，已标记超时'),
           execution_time_ms = COALESCE(execution_time_ms, LEAST(
             FLOOR(EXTRACT(EPOCH FROM (NOW() - v_stale_execution.created_at)) * 1000),
             2147483647
           )::INTEGER),
           completed_work_units = CASE WHEN EXISTS (
             SELECT 1 FROM public.presales_execution_work_units wu
              WHERE wu.execution_id = v_stale_execution.id
                AND wu.status IN ('succeeded', 'failed', 'cancelled')
           ) THEN 1 ELSE 0 END,
           completed_at = COALESCE(completed_at, NOW()),
           execution_lease_token = NULL,
           leased_by = NULL,
           lease_expires_at = NULL
     WHERE id = v_stale_execution.id AND status = 'running';
    IF NOT FOUND THEN CONTINUE; END IF;

    v_previous_status := v_stale_execution.input_data->>'previousProjectStatus';
    IF v_previous_status NOT IN ('draft', 'completed') THEN
      v_previous_status := 'draft';
    END IF;
    UPDATE public.projects
       SET status = CASE WHEN status = 'analyzing' THEN v_previous_status ELSE status END
     WHERE id = v_stale_execution.project_id AND status <> 'archived';
    v_reconciled := v_reconciled + 1;
  END LOOP;
  RETURN v_reconciled;
END;
$$;

DROP FUNCTION IF EXISTS public.commit_presales_execution(UUID, UUID, JSONB, INTEGER);
CREATE FUNCTION public.commit_presales_execution(
  p_actor_user_id UUID,
  p_execution_id UUID,
  p_execution_lease_token UUID,
  p_execution_lease_generation BIGINT,
  p_worker_id TEXT,
  p_snapshot JSONB,
  p_execution_time_ms INTEGER
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_execution public.agent_executions%ROWTYPE;
  v_project public.projects%ROWTYPE;
  v_baseline public.requirement_baselines%ROWTYPE;
  v_discovery JSONB;
  v_item JSONB;
  v_sequence INTEGER;
  v_expected_version_id UUID;
  v_revision_no BIGINT;
  v_estimate_version_id UUID;
  v_output_snapshot JSONB;
  v_snapshot_hash TEXT;
  v_expected_cost JSONB;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以提交售前分析' USING ERRCODE = '42501';
  END IF;
  IF p_actor_user_id IS NULL OR NULLIF(btrim(p_worker_id), '') IS NULL THEN
    RAISE EXCEPTION '缺少执行发起用户或 worker' USING ERRCODE = '22023';
  END IF;

  SELECT ae.project_id INTO v_execution.project_id
    FROM public.agent_executions ae
    JOIN public.projects p ON p.id = ae.project_id
   WHERE ae.id = p_execution_id
     AND ae.requested_by = p_actor_user_id
     AND p.created_by = p_actor_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '执行记录不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;

  SELECT p.* INTO v_project
    FROM public.projects p
   WHERE p.id = v_execution.project_id AND p.created_by = p_actor_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '项目不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;

  SELECT ae.* INTO v_execution
    FROM public.agent_executions ae
   WHERE ae.id = p_execution_id
     AND ae.project_id = v_project.id
     AND ae.requested_by = p_actor_user_id
     AND ae.status = 'running'
     AND ae.execution_lease_token = p_execution_lease_token
     AND ae.execution_lease_generation = p_execution_lease_generation
     AND ae.leased_by = btrim(p_worker_id)
     AND ae.lease_expires_at > NOW()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '执行记录不存在、已结束或租约已失效' USING ERRCODE = '40001';
  END IF;
  IF v_project.status = 'archived' THEN
    RAISE EXCEPTION '项目已归档，拒绝提交估算结果' USING ERRCODE = '40001';
  END IF;
  IF v_execution.requirement_baseline_id IS NULL
     OR v_execution.requirement_baseline_content_hash IS NULL
     OR v_execution.system_config_snapshot IS NULL
     OR v_execution.model_id IS NULL
     OR v_execution.workflow_version IS NULL
     OR v_execution.prompt_versions IS NULL
     OR v_execution.output_schema_version IS NULL THEN
    RAISE EXCEPTION '执行记录缺少不可变输入或版本来源' USING ERRCODE = '22023';
  END IF;
  IF v_project.current_requirement_baseline_id
       IS DISTINCT FROM v_execution.requirement_baseline_id THEN
    RAISE EXCEPTION '项目当前需求基线已变化，拒绝提交旧基线估算' USING ERRCODE = '40001';
  END IF;

  SELECT rb.* INTO v_baseline
    FROM public.requirement_baselines rb
   WHERE rb.id = v_execution.requirement_baseline_id
     AND rb.project_id = v_project.id;
  IF NOT FOUND
     OR v_baseline.content_hash IS DISTINCT FROM v_execution.requirement_baseline_content_hash
     OR v_baseline.content_hash IS DISTINCT FROM pg_catalog.encode(
       extensions.digest(pg_catalog.convert_to(v_baseline.canonical_content, 'UTF8'), 'sha256'),
       'hex'
     ) THEN
    RAISE EXCEPTION '执行绑定的需求基线或内容哈希无效' USING ERRCODE = '40001';
  END IF;

  BEGIN
    v_expected_version_id := NULLIF(
      v_execution.input_data->>'expectedEstimateVersionId', ''
    )::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION '执行记录的开始估算版本无效' USING ERRCODE = '22023';
  END;
  IF v_project.latest_estimate_version_id IS DISTINCT FROM v_expected_version_id THEN
    RAISE EXCEPTION '估算版本冲突' USING ERRCODE = '40001';
  END IF;

  IF p_snapshot IS NULL OR pg_catalog.jsonb_typeof(p_snapshot) <> 'object'
     OR pg_catalog.jsonb_typeof(p_snapshot->'parsedRequirement') <> 'object'
     OR pg_catalog.jsonb_typeof(p_snapshot->'functionModules') <> 'array'
     OR pg_catalog.jsonb_array_length(p_snapshot->'functionModules') < 1
     OR pg_catalog.jsonb_typeof(p_snapshot->'projectRoles') <> 'array'
     OR pg_catalog.jsonb_typeof(p_snapshot->'additionalWorkItems') <> 'array'
     OR pg_catalog.jsonb_typeof(p_snapshot->'costEstimate') <> 'object'
     OR pg_catalog.jsonb_typeof(p_snapshot->'outputData') <> 'object' THEN
    RAISE EXCEPTION '持久化快照结构无效' USING ERRCODE = '22023';
  END IF;

  IF p_snapshot->'parsedRequirement' IS DISTINCT FROM p_snapshot->'outputData'->'analysis' THEN
    RAISE EXCEPTION '需求分析快照与工作流结果不一致' USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    (
      SELECT
        item->>'module_name', item->>'function_name', item->>'description',
        item->>'difficulty_level', COALESCE(item->'dependencies', 'null'::jsonb),
        COALESCE(item->'role_estimates', '[]'::jsonb)
      FROM pg_catalog.jsonb_array_elements(p_snapshot->'functionModules') item
      EXCEPT ALL
      SELECT
        item->>'moduleName', item->>'functionName', item->>'description',
        item->>'difficultyLevel', COALESCE(item->'dependencies', 'null'::jsonb),
        COALESCE(item->'roleEstimates', '[]'::jsonb)
      FROM pg_catalog.jsonb_array_elements(p_snapshot->'outputData'->'functions') item
    )
    UNION ALL
    (
      SELECT
        item->>'moduleName', item->>'functionName', item->>'description',
        item->>'difficultyLevel', COALESCE(item->'dependencies', 'null'::jsonb),
        COALESCE(item->'roleEstimates', '[]'::jsonb)
      FROM pg_catalog.jsonb_array_elements(p_snapshot->'outputData'->'functions') item
      EXCEPT ALL
      SELECT
        item->>'module_name', item->>'function_name', item->>'description',
        item->>'difficulty_level', COALESCE(item->'dependencies', 'null'::jsonb),
        COALESCE(item->'role_estimates', '[]'::jsonb)
      FROM pg_catalog.jsonb_array_elements(p_snapshot->'functionModules') item
    )
  ) THEN
    RAISE EXCEPTION '功能快照与工作流结果不一致' USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_snapshot->'functionModules') item
     WHERE (item->>'estimated_hours')::NUMERIC IS DISTINCT FROM (
       SELECT COALESCE(SUM((role->>'days')::NUMERIC), 0)
         FROM pg_catalog.jsonb_array_elements(COALESCE(item->'role_estimates', '[]'::jsonb)) role
     ) * (p_snapshot->'costEstimate'->>'working_hours_per_day')::NUMERIC
  ) THEN
    RAISE EXCEPTION '功能工时快照与角色工时不一致' USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    (
      SELECT item->>'role_name', item->>'responsibility', item->>'headcount', item->>'total_days'
      FROM pg_catalog.jsonb_array_elements(p_snapshot->'projectRoles') item
      EXCEPT ALL
      SELECT role->>'role', role->>'responsibility', role->>'headcount', staffing->>'totalDays'
      FROM pg_catalog.jsonb_array_elements(p_snapshot->'outputData'->'identifiedRoles') role
      LEFT JOIN LATERAL (
        SELECT value AS staffing
          FROM pg_catalog.jsonb_array_elements(p_snapshot->'outputData'->'cost'->'staffingByRole')
         WHERE value->>'role' = role->>'role'
         LIMIT 1
      ) matched ON TRUE
    )
    UNION ALL
    (
      SELECT role->>'role', role->>'responsibility', role->>'headcount', staffing->>'totalDays'
      FROM pg_catalog.jsonb_array_elements(p_snapshot->'outputData'->'identifiedRoles') role
      LEFT JOIN LATERAL (
        SELECT value AS staffing
          FROM pg_catalog.jsonb_array_elements(p_snapshot->'outputData'->'cost'->'staffingByRole')
         WHERE value->>'role' = role->>'role'
         LIMIT 1
      ) matched ON TRUE
      EXCEPT ALL
      SELECT item->>'role_name', item->>'responsibility', item->>'headcount', item->>'total_days'
      FROM pg_catalog.jsonb_array_elements(p_snapshot->'projectRoles') item
    )
  ) THEN
    RAISE EXCEPTION '角色快照与工作流结果不一致' USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    (
      SELECT item->>'work_item', item->>'days', COALESCE(item->'assigned_roles', '[]'::jsonb)
      FROM pg_catalog.jsonb_array_elements(p_snapshot->'additionalWorkItems') item
      EXCEPT ALL
      SELECT item->>'workItem', item->>'days', COALESCE(item->'assignedRoles', '[]'::jsonb)
      FROM pg_catalog.jsonb_array_elements(p_snapshot->'outputData'->'additionalWork') item
    )
    UNION ALL
    (
      SELECT item->>'workItem', item->>'days', COALESCE(item->'assignedRoles', '[]'::jsonb)
      FROM pg_catalog.jsonb_array_elements(p_snapshot->'outputData'->'additionalWork') item
      EXCEPT ALL
      SELECT item->>'work_item', item->>'days', COALESCE(item->'assigned_roles', '[]'::jsonb)
      FROM pg_catalog.jsonb_array_elements(p_snapshot->'additionalWorkItems') item
    )
  ) THEN
    RAISE EXCEPTION '额外工作快照与工作流结果不一致' USING ERRCODE = '40001';
  END IF;

  v_expected_cost := pg_catalog.jsonb_build_object(
    'labor_cost', p_snapshot->'outputData'->'cost'->'laborCost',
    'service_cost', p_snapshot->'outputData'->'cost'->'serviceCost',
    'infrastructure_cost', p_snapshot->'outputData'->'cost'->'infrastructureCost',
    'buffer_percentage', p_snapshot->'costEstimate'->'buffer_percentage',
    'total_cost', p_snapshot->'outputData'->'cost'->'totalCost',
    'base_days', p_snapshot->'outputData'->'cost'->'baseDays',
    'buffered_days', p_snapshot->'outputData'->'cost'->'bufferedDays',
    'buffer_coefficient', p_snapshot->'outputData'->'cost'->'bufferCoefficient',
    'rule_version', p_snapshot->'outputData'->'cost'->'ruleVersion',
    'service_policy_version', p_snapshot->'outputData'->'cost'->'servicePolicyVersion',
    'currency', p_snapshot->'outputData'->'cost'->'currency',
    'labor_cost_per_day', p_snapshot->'outputData'->'cost'->'laborCostPerDay',
    'working_hours_per_day', p_snapshot->'outputData'->'cost'->'workingHoursPerDay',
    'breakdown', pg_catalog.jsonb_build_object(
      'roleBreakdown', p_snapshot->'outputData'->'cost'->'roleBreakdown',
      'additionalWorkBreakdown', p_snapshot->'outputData'->'cost'->'additionalWorkBreakdown',
      'thirdPartyServices', p_snapshot->'outputData'->'cost'->'thirdPartyServices',
      'ruleVersion', p_snapshot->'outputData'->'cost'->'ruleVersion',
      'servicePolicyVersion', p_snapshot->'outputData'->'cost'->'servicePolicyVersion',
      'currency', p_snapshot->'outputData'->'cost'->'currency',
      'laborCostPerDay', p_snapshot->'outputData'->'cost'->'laborCostPerDay',
      'workingHoursPerDay', p_snapshot->'outputData'->'cost'->'workingHoursPerDay',
      'bufferDays', p_snapshot->'outputData'->'cost'->'bufferDays',
      'estimatedDurationDays', p_snapshot->'outputData'->'cost'->'estimatedDurationDays',
      'reconciliation', p_snapshot->'outputData'->'cost'->'reconciliation'
    )
  );
  IF p_snapshot->'costEstimate' IS DISTINCT FROM v_expected_cost
     OR (p_snapshot->'costEstimate'->>'buffer_percentage')::NUMERIC IS DISTINCT FROM
       ((p_snapshot->'costEstimate'->>'buffer_coefficient')::NUMERIC - 1) * 100
     OR (p_snapshot->'costEstimate'->>'total_cost')::NUMERIC IS DISTINCT FROM
       (p_snapshot->'costEstimate'->>'labor_cost')::NUMERIC
       + (p_snapshot->'costEstimate'->>'service_cost')::NUMERIC
       + (p_snapshot->'costEstimate'->>'infrastructure_cost')::NUMERIC
     OR p_snapshot->'costEstimate'->'breakdown'->'reconciliation'->>'isBalanced'
       IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '成本快照与工作流结果或成本汇总不一致' USING ERRCODE = '40001';
  END IF;

  IF v_execution.orchestration_run_id IS NOT NULL THEN
    IF v_execution.manifest IS NULL
       OR v_execution.manifest_hash IS NULL
       OR v_execution.model_profile_version IS NULL
       OR v_execution.prompt_bundle_hash IS NULL
       OR v_execution.planned_work_units IS DISTINCT FROM 1
       OR v_execution.completed_work_units IS DISTINCT FROM 1
       OR (SELECT COUNT(*) FROM public.presales_execution_work_units wu
            WHERE wu.execution_id = v_execution.id) <> 1 THEN
      RAISE EXCEPTION '正式后台执行计划不完整' USING ERRCODE = '40001';
    END IF;

    SELECT wu.output_payload INTO v_discovery
      FROM public.presales_execution_work_units wu
     WHERE wu.execution_id = v_execution.id
       AND wu.stage = 'full_document_discovery'
       AND wu.unit_key = 'global'
       AND wu.status = 'succeeded';
    IF NOT FOUND
       OR pg_catalog.jsonb_typeof(v_discovery->'analysis') <> 'object'
       OR pg_catalog.jsonb_typeof(v_discovery->'functions') <> 'array'
       OR pg_catalog.jsonb_array_length(v_discovery->'functions') < 1 THEN
      RAISE EXCEPTION '执行缺少成功的全文需求分析产物' USING ERRCODE = '40001';
    END IF;
    IF v_discovery->'analysis' IS DISTINCT FROM p_snapshot->'parsedRequirement' THEN
      RAISE EXCEPTION '正式需求分析与冻结的全文产物不一致' USING ERRCODE = '40001';
    END IF;
    IF EXISTS (
      (
        SELECT
          item->>'module_name', item->>'function_name', item->>'description',
          item->>'difficulty_level', COALESCE(item->'dependencies', 'null'::jsonb)
        FROM pg_catalog.jsonb_array_elements(p_snapshot->'functionModules') item
        EXCEPT ALL
        SELECT
          item->>'moduleName', item->>'functionName', item->>'description',
          item->>'difficultyLevel', COALESCE(item->'dependencies', 'null'::jsonb)
        FROM pg_catalog.jsonb_array_elements(v_discovery->'functions') item
      )
      UNION ALL
      (
        SELECT
          item->>'moduleName', item->>'functionName', item->>'description',
          item->>'difficultyLevel', COALESCE(item->'dependencies', 'null'::jsonb)
        FROM pg_catalog.jsonb_array_elements(v_discovery->'functions') item
        EXCEPT ALL
        SELECT
          item->>'module_name', item->>'function_name', item->>'description',
          item->>'difficulty_level', COALESCE(item->'dependencies', 'null'::jsonb)
        FROM pg_catalog.jsonb_array_elements(p_snapshot->'functionModules') item
      )
    ) THEN
      RAISE EXCEPTION '正式功能集合与冻结的全文产物不一致' USING ERRCODE = '40001';
    END IF;
  END IF;

  IF v_project.latest_estimate_version_id IS NULL THEN
    v_revision_no := 1;
  ELSE
    SELECT ev.revision_no + 1 INTO v_revision_no
      FROM public.estimate_versions ev
     WHERE ev.id = v_project.latest_estimate_version_id
       AND ev.project_id = v_project.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '项目最新估算版本指针无效' USING ERRCODE = '40001';
    END IF;
  END IF;

  v_output_snapshot := pg_catalog.jsonb_build_object(
    'schemaVersion', 'presales-estimate-v1',
    'parsedRequirement', p_snapshot->'parsedRequirement',
    'functionModules', p_snapshot->'functionModules',
    'projectRoles', p_snapshot->'projectRoles',
    'additionalWorkItems', p_snapshot->'additionalWorkItems',
    'costEstimate', p_snapshot->'costEstimate',
    'workflowResult', p_snapshot->'outputData',
    'executionProvenance', pg_catalog.jsonb_build_object(
      'manifestHash', v_execution.manifest_hash,
      'modelProfileVersion', v_execution.model_profile_version,
      'promptBundleHash', v_execution.prompt_bundle_hash,
      'modelCallCount', v_execution.model_call_count,
      'inputTokens', v_execution.input_tokens,
      'outputTokens', v_execution.output_tokens,
      'totalTokens', v_execution.total_tokens
    )
  );
  v_snapshot_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_output_snapshot::TEXT, 'UTF8'), 'sha256'),
    'hex'
  );

  INSERT INTO public.estimate_versions (
    project_id, revision_no, parent_version_id, requirement_baseline_id,
    requirement_baseline_content_hash, agent_execution_id, generation_kind,
    input_snapshot, system_config_snapshot, parsed_requirement, output_snapshot,
    snapshot_hash, model_id, workflow_version, prompt_versions,
    output_schema_version, cost_rule_version, service_policy_version, created_by
  ) VALUES (
    v_project.id, v_revision_no, v_project.latest_estimate_version_id,
    v_baseline.id, v_baseline.content_hash, v_execution.id, 'ai_workflow',
    pg_catalog.jsonb_build_object(
      'requirementBaselineId', v_baseline.id,
      'requirementBaselineRevision', v_baseline.revision_no,
      'requirementBaselineContentHash', v_baseline.content_hash,
      'projectDescriptionSnapshot', v_baseline.project_description_snapshot,
      'manifest', v_execution.manifest,
      'capacityPlan', v_execution.input_data->'capacityPlan'
    ),
    v_execution.system_config_snapshot, p_snapshot->'parsedRequirement',
    v_output_snapshot, v_snapshot_hash, v_execution.model_id,
    v_execution.workflow_version, v_execution.prompt_versions,
    v_execution.output_schema_version,
    p_snapshot->'costEstimate'->>'rule_version',
    p_snapshot->'costEstimate'->>'service_policy_version', p_actor_user_id
  ) RETURNING id INTO v_estimate_version_id;

  v_sequence := 0;
  FOR v_item IN
    SELECT value FROM pg_catalog.jsonb_array_elements(p_snapshot->'functionModules')
  LOOP
    INSERT INTO public.estimate_version_functions (
      estimate_version_id, project_id, sequence_no, module_name, function_name,
      description, difficulty_level, estimated_hours, dependencies, role_estimates,
      is_verified
    ) VALUES (
      v_estimate_version_id, v_project.id, v_sequence,
      v_item->>'module_name', v_item->>'function_name', NULLIF(v_item->>'description', ''),
      v_item->>'difficulty_level', (v_item->>'estimated_hours')::DECIMAL,
      CASE
        WHEN v_item->'dependencies' IS NULL OR v_item->'dependencies' = 'null'::jsonb
          THEN NULL
        ELSE ARRAY(
          SELECT pg_catalog.jsonb_array_elements_text(v_item->'dependencies')
        )
      END,
      COALESCE(v_item->'role_estimates', '[]'::jsonb), FALSE
    );
    v_sequence := v_sequence + 1;
  END LOOP;

  v_sequence := 0;
  FOR v_item IN
    SELECT value FROM pg_catalog.jsonb_array_elements(p_snapshot->'projectRoles')
  LOOP
    INSERT INTO public.estimate_version_roles (
      estimate_version_id, project_id, sequence_no, role_name,
      responsibility, headcount, total_days
    ) VALUES (
      v_estimate_version_id, v_project.id, v_sequence, v_item->>'role_name',
      NULLIF(v_item->>'responsibility', ''), (v_item->>'headcount')::INTEGER,
      (v_item->>'total_days')::DECIMAL
    );
    v_sequence := v_sequence + 1;
  END LOOP;

  v_sequence := 0;
  FOR v_item IN
    SELECT value FROM pg_catalog.jsonb_array_elements(p_snapshot->'additionalWorkItems')
  LOOP
    INSERT INTO public.estimate_version_additional_work (
      estimate_version_id, project_id, sequence_no, work_item, days, assigned_roles
    ) VALUES (
      v_estimate_version_id, v_project.id, v_sequence, v_item->>'work_item',
      (v_item->>'days')::DECIMAL,
      ARRAY(
        SELECT pg_catalog.jsonb_array_elements_text(
          COALESCE(v_item->'assigned_roles', '[]'::jsonb)
        )
      )
    );
    v_sequence := v_sequence + 1;
  END LOOP;

  v_item := p_snapshot->'costEstimate';
  INSERT INTO public.estimate_version_costs (
    estimate_version_id, project_id, labor_cost, service_cost, infrastructure_cost,
    buffer_percentage, total_cost, base_days, buffered_days, buffer_coefficient,
    rule_version, service_policy_version, currency, labor_cost_per_day,
    working_hours_per_day, breakdown
  ) VALUES (
    v_estimate_version_id, v_project.id, (v_item->>'labor_cost')::DECIMAL,
    (v_item->>'service_cost')::DECIMAL, (v_item->>'infrastructure_cost')::DECIMAL,
    (v_item->>'buffer_percentage')::DECIMAL, (v_item->>'total_cost')::DECIMAL,
    (v_item->>'base_days')::DECIMAL, (v_item->>'buffered_days')::DECIMAL,
    (v_item->>'buffer_coefficient')::DECIMAL, v_item->>'rule_version',
    v_item->>'service_policy_version', v_item->>'currency',
    (v_item->>'labor_cost_per_day')::DECIMAL,
    (v_item->>'working_hours_per_day')::DECIMAL,
    COALESCE(v_item->'breakdown', '{}'::jsonb)
  );

  UPDATE public.agent_executions
     SET status = 'completed', estimate_version_id = v_estimate_version_id,
         output_data = pg_catalog.jsonb_build_object(
           'estimateVersionId', v_estimate_version_id,
           'snapshotHash', v_snapshot_hash,
           'result', p_snapshot->'outputData'
         ),
         error_message = NULL,
         execution_time_ms = GREATEST(COALESCE(p_execution_time_ms, 0), 0),
         current_stage = 'complete', progress_percent = 100,
         completed_at = NOW(), execution_lease_token = NULL,
         leased_by = NULL, lease_expires_at = NULL
   WHERE id = p_execution_id;

  UPDATE public.projects
     SET status = 'completed', latest_estimate_version_id = v_estimate_version_id,
         estimate_revision = v_revision_no
   WHERE id = v_project.id;

  RETURN v_estimate_version_id;
END;
$$;

DROP FUNCTION IF EXISTS public.finish_presales_execution(UUID, UUID, TEXT, TEXT, INTEGER);
CREATE FUNCTION public.finish_presales_execution(
  p_actor_user_id UUID,
  p_execution_id UUID,
  p_execution_lease_token UUID,
  p_execution_lease_generation BIGINT,
  p_worker_id TEXT,
  p_status TEXT,
  p_error_message TEXT,
  p_execution_time_ms INTEGER
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_execution public.agent_executions%ROWTYPE;
  v_project_id UUID;
  v_previous_status TEXT;
  v_terminal_work_units INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以结束售前分析' USING ERRCODE = '42501';
  END IF;
  IF p_actor_user_id IS NULL
     OR NULLIF(btrim(p_worker_id), '') IS NULL
     OR p_status NOT IN ('failed', 'cancelled', 'timed_out') THEN
    RAISE EXCEPTION '售前执行终态参数无效' USING ERRCODE = '22023';
  END IF;

  SELECT ae.project_id INTO v_project_id
    FROM public.agent_executions ae
    JOIN public.projects p ON p.id = ae.project_id
   WHERE ae.id = p_execution_id
     AND ae.requested_by = p_actor_user_id
     AND p.created_by = p_actor_user_id;
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM 1 FROM public.projects p
   WHERE p.id = v_project_id AND p.created_by = p_actor_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT ae.* INTO v_execution FROM public.agent_executions ae
   WHERE ae.id = p_execution_id
     AND ae.project_id = v_project_id
     AND ae.requested_by = p_actor_user_id
     AND ae.status = 'running'
     AND ae.execution_lease_token = p_execution_lease_token
     AND ae.execution_lease_generation = p_execution_lease_generation
     AND ae.leased_by = btrim(p_worker_id)
     AND ae.lease_expires_at > NOW()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '结束售前执行时租约已失效' USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = v_project_id AND p.status = 'archived'
  ) THEN
    p_status := 'cancelled';
    p_error_message := '项目已归档，执行已取消';
  END IF;

  UPDATE public.presales_execution_work_units
     SET status = 'cancelled', lease_token = NULL, leased_by = NULL,
         lease_expires_at = NULL, completed_at = NOW(), updated_at = NOW(),
         error_code = 'EXECUTION_TERMINATED', error_message = p_error_message
   WHERE execution_id = p_execution_id
     AND status IN ('pending', 'leased', 'retry_wait');

  SELECT COUNT(*)::INTEGER INTO v_terminal_work_units
    FROM public.presales_execution_work_units wu
   WHERE wu.execution_id = p_execution_id
     AND wu.status IN ('succeeded', 'failed', 'cancelled');

  UPDATE public.agent_executions
     SET status = p_status, error_message = p_error_message,
         completed_work_units = LEAST(v_terminal_work_units, planned_work_units),
         execution_time_ms = GREATEST(COALESCE(p_execution_time_ms, 0), 0),
         completed_at = NOW(), execution_lease_token = NULL,
         leased_by = NULL, lease_expires_at = NULL
   WHERE id = p_execution_id;

  v_previous_status := v_execution.input_data->>'previousProjectStatus';
  IF v_previous_status NOT IN ('draft', 'completed') THEN
    v_previous_status := 'draft';
  END IF;
  UPDATE public.projects
     SET status = v_previous_status
   WHERE id = v_project_id AND status <> 'archived';
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_presales_execution(
  p_actor_user_id UUID,
  p_execution_id UUID,
  p_execution_lease_token UUID,
  p_execution_lease_generation BIGINT,
  p_worker_id TEXT,
  p_status TEXT,
  p_error_message TEXT,
  p_execution_time_ms INTEGER
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.finish_presales_execution(
    p_actor_user_id,
    p_execution_id,
    p_execution_lease_token,
    p_execution_lease_generation,
    p_worker_id,
    p_status,
    p_error_message,
    p_execution_time_ms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_presales_execution(
  UUID, UUID, UUID, TEXT, JSONB, JSONB, TEXT, TEXT, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.initialize_presales_execution_plan(
  UUID, UUID, JSONB, TEXT, TEXT, TEXT, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_presales_execution(UUID, UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.heartbeat_presales_execution(
  UUID, UUID, UUID, BIGINT, TEXT, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_presales_work_unit(
  UUID, UUID, UUID, BIGINT, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.heartbeat_presales_work_unit(
  UUID, UUID, BIGINT, UUID, UUID, BIGINT, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_presales_model_call(
  UUID, UUID, BIGINT, TEXT, UUID, UUID, BIGINT, UUID, TEXT, TEXT, INTEGER,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, INTEGER,
  BOOLEAN, BOOLEAN, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_presales_work_unit(
  UUID, UUID, BIGINT, UUID, UUID, BIGINT, TEXT, JSONB, TEXT, BIGINT, BIGINT,
  INTEGER, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_presales_work_unit(
  UUID, UUID, BIGINT, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_stale_presales_executions(INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_presales_execution(
  UUID, UUID, UUID, BIGINT, TEXT, JSONB, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_presales_execution(
  UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_presales_execution(
  UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.begin_presales_execution(
  UUID, UUID, UUID, TEXT, JSONB, JSONB, TEXT, TEXT, JSONB, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.initialize_presales_execution_plan(
  UUID, UUID, JSONB, TEXT, TEXT, TEXT, JSONB, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_presales_execution(UUID, UUID, TEXT, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_presales_execution(
  UUID, UUID, UUID, BIGINT, TEXT, TEXT, INTEGER, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_presales_work_unit(
  UUID, UUID, UUID, BIGINT, TEXT, TEXT, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_presales_work_unit(
  UUID, UUID, BIGINT, UUID, UUID, BIGINT, TEXT, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_presales_model_call(
  UUID, UUID, BIGINT, TEXT, UUID, UUID, BIGINT, UUID, TEXT, TEXT, INTEGER,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, INTEGER,
  BOOLEAN, BOOLEAN, JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_presales_work_unit(
  UUID, UUID, BIGINT, UUID, UUID, BIGINT, TEXT, JSONB, TEXT, BIGINT, BIGINT,
  INTEGER, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_presales_work_unit(
  UUID, UUID, BIGINT, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_presales_executions(INTEGER, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_presales_execution(
  UUID, UUID, UUID, BIGINT, TEXT, JSONB, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_presales_execution(
  UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_presales_execution(
  UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, INTEGER
) TO service_role;
