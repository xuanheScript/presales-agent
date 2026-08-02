-- Agent 执行生命周期、并发控制与售前结果原子保存

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS estimate_revision BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.agent_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  requirement_id UUID REFERENCES public.requirements(id) ON DELETE SET NULL,
  agent_type TEXT NOT NULL,
  input_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_data JSONB,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'timed_out')),
  error_message TEXT,
  execution_time_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.agent_executions
  ADD COLUMN IF NOT EXISTS requirement_id UUID REFERENCES public.requirements(id) ON DELETE SET NULL;

-- CREATE TABLE IF NOT EXISTS 不会修正已存在表的列约束，先显式检查历史脏数据。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.agent_executions
     WHERE project_id IS NULL
        OR agent_type IS NULL
        OR input_data IS NULL
        OR status IS NULL
        OR created_at IS NULL
  ) THEN
    RAISE EXCEPTION 'agent_executions 存在违反目标非空约束的历史数据，请先修复后重跑迁移';
  END IF;
END;
$$;

ALTER TABLE public.agent_executions
  ALTER COLUMN project_id SET NOT NULL,
  ALTER COLUMN agent_type SET NOT NULL,
  ALTER COLUMN input_data SET DEFAULT '{}'::jsonb,
  ALTER COLUMN input_data SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'running',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE public.agent_executions DROP CONSTRAINT IF EXISTS agent_executions_status_check;
ALTER TABLE public.agent_executions
  ADD CONSTRAINT agent_executions_status_check
  CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'timed_out'));

CREATE INDEX IF NOT EXISTS idx_agent_executions_project_id
  ON public.agent_executions(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_requirement_id
  ON public.agent_executions(requirement_id)
  WHERE requirement_id IS NOT NULL;

-- 先收敛明显过期的历史记录；对于仍存在的并发 running 数据拒绝猜测终态，
-- 由部署人员核实后重跑迁移，避免唯一索引创建时给出不明确错误。
UPDATE public.agent_executions
   SET status = 'timed_out',
       error_message = COALESCE(error_message, '迁移时发现执行超过 10 分钟未结束，已自动过期'),
       execution_time_ms = COALESCE(
         execution_time_ms,
         LEAST(
           FLOOR(EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000),
           2147483647
         )::INTEGER
       ),
       completed_at = COALESCE(completed_at, NOW())
 WHERE status = 'running'
   AND created_at < NOW() - INTERVAL '10 minutes';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.agent_executions
     WHERE status = 'running'
     GROUP BY project_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION '存在同一项目的多个 running Agent 执行，请核实终态后重新执行迁移';
  END IF;
END;
$$;

-- 不使用 IF NOT EXISTS 静默接受同名但定义错误的历史索引。
DROP INDEX IF EXISTS public.uq_agent_executions_running_project;
CREATE UNIQUE INDEX uq_agent_executions_running_project
  ON public.agent_executions(project_id)
  WHERE status = 'running';

ALTER TABLE public.agent_executions ENABLE ROW LEVEL SECURITY;

-- commit_presales_execution 保持 SECURITY INVOKER，因此补齐其所需的最小写策略。
-- 所有策略都通过项目归属约束当前 auth.uid()，不使用 service role 绕过 RLS。
DROP POLICY IF EXISTS "用户可以更新自己项目的需求" ON public.requirements;
CREATE POLICY "用户可以更新自己项目的需求"
  ON public.requirements FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = requirements.project_id
        AND projects.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = requirements.project_id
        AND projects.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "用户可以为自己的项目添加成本估算" ON public.cost_estimates;
CREATE POLICY "用户可以为自己的项目添加成本估算"
  ON public.cost_estimates FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = cost_estimates.project_id
        AND projects.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "用户可以删除自己项目的成本估算" ON public.cost_estimates;
CREATE POLICY "用户可以删除自己项目的成本估算"
  ON public.cost_estimates FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = cost_estimates.project_id
        AND projects.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "用户可以查看自己项目的 Agent 执行记录" ON public.agent_executions;
CREATE POLICY "用户可以查看自己项目的 Agent 执行记录"
  ON public.agent_executions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = agent_executions.project_id
        AND projects.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "用户可以创建自己项目的 Agent 执行记录" ON public.agent_executions;
CREATE POLICY "用户可以创建自己项目的 Agent 执行记录"
  ON public.agent_executions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = agent_executions.project_id
        AND projects.created_by = auth.uid()
    )
    AND (
      agent_executions.requirement_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.requirements
        WHERE requirements.id = agent_executions.requirement_id
          AND requirements.project_id = agent_executions.project_id
      )
    )
  );

DROP POLICY IF EXISTS "用户可以更新自己项目的 Agent 执行记录" ON public.agent_executions;
CREATE POLICY "用户可以更新自己项目的 Agent 执行记录"
  ON public.agent_executions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = agent_executions.project_id
        AND projects.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = agent_executions.project_id
        AND projects.created_by = auth.uid()
    )
    AND (
      agent_executions.requirement_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.requirements
        WHERE requirements.id = agent_executions.requirement_id
          AND requirements.project_id = agent_executions.project_id
      )
    )
  );

CREATE OR REPLACE FUNCTION public.begin_presales_execution(
  p_project_id UUID,
  p_requirement_id UUID,
  p_agent_type TEXT,
  p_input_data JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_execution_id UUID;
  v_previous_status TEXT;
  v_estimate_revision BIGINT;
BEGIN
  SELECT p.status, p.estimate_revision
    INTO v_previous_status, v_estimate_revision
    FROM public.projects p
   WHERE p.id = p_project_id
     AND p.created_by = auth.uid()
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '项目不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;

  IF v_previous_status = 'archived' THEN
    RAISE EXCEPTION '归档项目不能执行分析' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.requirements r
     WHERE r.id = p_requirement_id
       AND r.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION '需求与项目不匹配' USING ERRCODE = '23503';
  END IF;

  -- 防止平台异常退出留下的旧 running 记录永久阻塞后续执行。
  UPDATE public.agent_executions ae
     SET status = 'timed_out',
         error_message = '执行超过 10 分钟未结束，已自动过期',
         execution_time_ms = LEAST(
           FLOOR(EXTRACT(EPOCH FROM (NOW() - ae.created_at)) * 1000),
           2147483647
         )::INTEGER,
         completed_at = NOW()
   WHERE ae.project_id = p_project_id
     AND ae.status = 'running'
     AND ae.created_at < NOW() - INTERVAL '10 minutes';

  INSERT INTO public.agent_executions (
    project_id,
    requirement_id,
    agent_type,
    input_data,
    status
  ) VALUES (
    p_project_id,
    p_requirement_id,
    p_agent_type,
    COALESCE(p_input_data, '{}'::jsonb) || jsonb_build_object(
      'previousProjectStatus', v_previous_status,
      'estimateRevision', v_estimate_revision
    ),
    'running'
  ) RETURNING id INTO v_execution_id;

  UPDATE public.projects
     SET status = 'analyzing'
   WHERE id = p_project_id;

  RETURN v_execution_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_presales_execution(
  p_execution_id UUID,
  p_snapshot JSONB,
  p_execution_time_ms INTEGER
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_execution public.agent_executions%ROWTYPE;
  v_project_id UUID;
  v_item JSONB;
  v_current_revision BIGINT;
  v_expected_revision BIGINT;
BEGIN
  SELECT ae.project_id
    INTO v_project_id
    FROM public.agent_executions ae
    JOIN public.projects p ON p.id = ae.project_id
   WHERE ae.id = p_execution_id
     AND p.created_by = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION '执行记录不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;

  -- 三个生命周期 RPC 始终先锁项目、再锁执行记录，避免 begin 与 commit 形成锁环。
  SELECT p.estimate_revision
    INTO v_current_revision
    FROM public.projects p
   WHERE p.id = v_project_id
     AND p.created_by = auth.uid()
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '项目不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;

  SELECT ae.*
    INTO v_execution
    FROM public.agent_executions ae
   WHERE ae.id = p_execution_id
     AND ae.project_id = v_project_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '执行记录关联项目已发生变化' USING ERRCODE = '40001';
  END IF;

  IF v_execution.status <> 'running' THEN
    RAISE EXCEPTION '执行记录状态不是 running: %', v_execution.status USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(v_execution.input_data->'estimateRevision') <> 'number' THEN
    RAISE EXCEPTION '执行记录缺少有效的开始估算版本' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_expected_revision := (v_execution.input_data->>'estimateRevision')::BIGINT;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION '执行记录的开始估算版本无效' USING ERRCODE = '22023';
  END;

  IF v_current_revision IS DISTINCT FROM v_expected_revision THEN
    RAISE EXCEPTION '估算版本冲突，开始版本: %，当前版本: %',
      v_expected_revision, v_current_revision USING ERRCODE = '40001';
  END IF;

  -- 在任何写操作前验证 RPC 边界的 JSON 结构，避免缺失字段被静默解释为空快照。
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' THEN
    RAISE EXCEPTION '持久化快照必须是 JSON 对象' USING ERRCODE = '22023';
  END IF;

  IF p_snapshot->'parsedRequirement' IS NULL
     OR p_snapshot->'parsedRequirement' = 'null'::jsonb
     OR jsonb_typeof(p_snapshot->'parsedRequirement') <> 'object' THEN
    RAISE EXCEPTION 'parsedRequirement 必须是 JSON 对象' USING ERRCODE = '22023';
  END IF;

  IF p_snapshot->'functionModules' IS NULL
     OR p_snapshot->'functionModules' = 'null'::jsonb
     OR jsonb_typeof(p_snapshot->'functionModules') <> 'array' THEN
    RAISE EXCEPTION 'functionModules 必须是 JSON 数组' USING ERRCODE = '22023';
  END IF;

  IF p_snapshot->'projectRoles' IS NULL
     OR p_snapshot->'projectRoles' = 'null'::jsonb
     OR jsonb_typeof(p_snapshot->'projectRoles') <> 'array' THEN
    RAISE EXCEPTION 'projectRoles 必须是 JSON 数组' USING ERRCODE = '22023';
  END IF;

  IF p_snapshot->'additionalWorkItems' IS NULL
     OR p_snapshot->'additionalWorkItems' = 'null'::jsonb
     OR jsonb_typeof(p_snapshot->'additionalWorkItems') <> 'array' THEN
    RAISE EXCEPTION 'additionalWorkItems 必须是 JSON 数组' USING ERRCODE = '22023';
  END IF;

  IF p_snapshot->'costEstimate' IS NULL
     OR p_snapshot->'costEstimate' = 'null'::jsonb
     OR jsonb_typeof(p_snapshot->'costEstimate') <> 'object' THEN
    RAISE EXCEPTION 'costEstimate 必须是 JSON 对象' USING ERRCODE = '22023';
  END IF;

  UPDATE public.requirements
     SET parsed_content = p_snapshot->'parsedRequirement'
   WHERE id = v_execution.requirement_id
     AND project_id = v_execution.project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '执行关联的需求不存在' USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.function_modules WHERE project_id = v_execution.project_id;
  DELETE FROM public.project_roles WHERE project_id = v_execution.project_id;
  DELETE FROM public.additional_work_items WHERE project_id = v_execution.project_id;
  DELETE FROM public.cost_estimates WHERE project_id = v_execution.project_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_snapshot->'functionModules', '[]'::jsonb))
  LOOP
    INSERT INTO public.function_modules (
      project_id, module_name, function_name, description, difficulty_level,
      estimated_hours, dependencies, role_estimates
    ) VALUES (
      v_execution.project_id,
      v_item->>'module_name',
      v_item->>'function_name',
      NULLIF(v_item->>'description', ''),
      v_item->>'difficulty_level',
      (v_item->>'estimated_hours')::DECIMAL,
      CASE
        WHEN v_item->'dependencies' IS NULL OR v_item->'dependencies' = 'null'::jsonb THEN NULL
        ELSE ARRAY(SELECT jsonb_array_elements_text(v_item->'dependencies'))
      END,
      COALESCE(v_item->'role_estimates', '[]'::jsonb)
    );
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_snapshot->'projectRoles', '[]'::jsonb))
  LOOP
    INSERT INTO public.project_roles (
      project_id, role_name, responsibility, headcount, total_days
    ) VALUES (
      v_execution.project_id,
      v_item->>'role_name',
      NULLIF(v_item->>'responsibility', ''),
      (v_item->>'headcount')::INTEGER,
      (v_item->>'total_days')::DECIMAL
    );
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_snapshot->'additionalWorkItems', '[]'::jsonb))
  LOOP
    INSERT INTO public.additional_work_items (
      project_id, work_item, days, assigned_roles
    ) VALUES (
      v_execution.project_id,
      v_item->>'work_item',
      (v_item->>'days')::DECIMAL,
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_item->'assigned_roles', '[]'::jsonb)))
    );
  END LOOP;

  v_item := p_snapshot->'costEstimate';

  INSERT INTO public.cost_estimates (
    project_id, labor_cost, service_cost, infrastructure_cost,
    buffer_percentage, total_cost, base_days, buffered_days,
    buffer_coefficient, breakdown
  ) VALUES (
    v_execution.project_id,
    (v_item->>'labor_cost')::DECIMAL,
    (v_item->>'service_cost')::DECIMAL,
    (v_item->>'infrastructure_cost')::DECIMAL,
    (v_item->>'buffer_percentage')::DECIMAL,
    (v_item->>'total_cost')::DECIMAL,
    (v_item->>'base_days')::DECIMAL,
    (v_item->>'buffered_days')::DECIMAL,
    (v_item->>'buffer_coefficient')::DECIMAL,
    COALESCE(v_item->'breakdown', '{}'::jsonb)
  );

  UPDATE public.agent_executions
     SET status = 'completed',
         output_data = p_snapshot->'outputData',
         error_message = NULL,
         execution_time_ms = GREATEST(COALESCE(p_execution_time_ms, 0), 0),
         completed_at = NOW()
   WHERE id = p_execution_id;

  UPDATE public.projects
     SET status = 'completed',
         estimate_revision = estimate_revision + 1
   WHERE id = v_execution.project_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_presales_execution(
  p_execution_id UUID,
  p_status TEXT,
  p_error_message TEXT,
  p_execution_time_ms INTEGER
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_execution public.agent_executions%ROWTYPE;
  v_project_id UUID;
  v_previous_status TEXT;
BEGIN
  IF p_status NOT IN ('failed', 'cancelled', 'timed_out') THEN
    RAISE EXCEPTION '不支持的终态: %', p_status USING ERRCODE = '22023';
  END IF;

  SELECT ae.project_id
    INTO v_project_id
    FROM public.agent_executions ae
    JOIN public.projects p ON p.id = ae.project_id
   WHERE ae.id = p_execution_id
     AND p.created_by = auth.uid();

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 与 begin/commit 保持相同锁序：project -> agent_execution。
  PERFORM 1
    FROM public.projects p
   WHERE p.id = v_project_id
     AND p.created_by = auth.uid()
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT ae.*
    INTO v_execution
    FROM public.agent_executions ae
   WHERE ae.id = p_execution_id
     AND ae.project_id = v_project_id
   FOR UPDATE;

  IF NOT FOUND OR v_execution.status <> 'running' THEN
    RETURN;
  END IF;

  v_previous_status := v_execution.input_data->>'previousProjectStatus';
  IF v_previous_status NOT IN ('draft', 'completed') THEN
    v_previous_status := 'draft';
  END IF;

  UPDATE public.agent_executions
     SET status = p_status,
         error_message = p_error_message,
         execution_time_ms = GREATEST(COALESCE(p_execution_time_ms, 0), 0),
         completed_at = NOW()
   WHERE id = p_execution_id;

  UPDATE public.projects
     SET status = v_previous_status
   WHERE id = v_execution.project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_presales_execution(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_presales_execution(UUID, JSONB, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_presales_execution(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC;
-- Supabase 默认权限可能直接授予 anon；仅撤销 PUBLIC 不会移除该显式授权。
REVOKE ALL ON FUNCTION public.begin_presales_execution(UUID, UUID, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.commit_presales_execution(UUID, JSONB, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.finish_presales_execution(UUID, TEXT, TEXT, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.begin_presales_execution(UUID, UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_presales_execution(UUID, JSONB, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_presales_execution(UUID, TEXT, TEXT, INTEGER) TO authenticated;
