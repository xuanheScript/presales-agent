-- 正式成本规则版本化与人工编辑原子重算

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS estimate_revision BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.cost_estimates
  ADD COLUMN IF NOT EXISTS rule_version TEXT NOT NULL DEFAULT 'legacy-formal-v0',
  ADD COLUMN IF NOT EXISTS service_policy_version TEXT NOT NULL DEFAULT 'legacy-service-v0',
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CNY',
  ADD COLUMN IF NOT EXISTS labor_cost_per_day DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS working_hours_per_day DECIMAL(6, 2) NOT NULL DEFAULT 8;

UPDATE public.cost_estimates
   SET labor_cost_per_day = CASE
     WHEN buffered_days IS NOT NULL AND buffered_days > 0
       THEN ROUND(labor_cost / buffered_days, 2)
     ELSE 1500
   END
 WHERE labor_cost_per_day IS NULL;

ALTER TABLE public.cost_estimates
  ALTER COLUMN labor_cost_per_day SET DEFAULT 1500,
  ALTER COLUMN labor_cost_per_day SET NOT NULL;

COMMENT ON COLUMN public.projects.estimate_revision IS '正式估算聚合的乐观并发版本';
COMMENT ON COLUMN public.cost_estimates.rule_version IS '成本计算规则版本';
COMMENT ON COLUMN public.cost_estimates.service_policy_version IS '第三方服务费规则版本';
COMMENT ON COLUMN public.cost_estimates.currency IS '成本快照币种';
COMMENT ON COLUMN public.cost_estimates.labor_cost_per_day IS '成本快照采用的人天单价';
COMMENT ON COLUMN public.cost_estimates.working_hours_per_day IS '成本快照采用的每日工作小时数';

UPDATE public.project_roles
   SET headcount = GREATEST(COALESCE(headcount, 1), 1),
       total_days = GREATEST(COALESCE(total_days, 0), 0)
 WHERE headcount IS NULL OR headcount <= 0
    OR total_days IS NULL OR total_days < 0;

ALTER TABLE public.cost_estimates DROP CONSTRAINT IF EXISTS cost_estimates_labor_cost_per_day_check;
ALTER TABLE public.cost_estimates
  ADD CONSTRAINT cost_estimates_labor_cost_per_day_check
  CHECK (labor_cost_per_day > 0) NOT VALID;
ALTER TABLE public.cost_estimates
  VALIDATE CONSTRAINT cost_estimates_labor_cost_per_day_check;

ALTER TABLE public.cost_estimates DROP CONSTRAINT IF EXISTS cost_estimates_working_hours_per_day_check;
ALTER TABLE public.cost_estimates
  ADD CONSTRAINT cost_estimates_working_hours_per_day_check
  CHECK (working_hours_per_day > 0) NOT VALID;
ALTER TABLE public.cost_estimates
  VALIDATE CONSTRAINT cost_estimates_working_hours_per_day_check;

ALTER TABLE public.project_roles DROP CONSTRAINT IF EXISTS project_roles_headcount_check;
ALTER TABLE public.project_roles
  ADD CONSTRAINT project_roles_headcount_check CHECK (headcount > 0) NOT VALID;
ALTER TABLE public.project_roles
  VALIDATE CONSTRAINT project_roles_headcount_check;

ALTER TABLE public.project_roles DROP CONSTRAINT IF EXISTS project_roles_total_days_check;
ALTER TABLE public.project_roles
  ADD CONSTRAINT project_roles_total_days_check CHECK (total_days >= 0) NOT VALID;
ALTER TABLE public.project_roles
  VALIDATE CONSTRAINT project_roles_total_days_check;

DROP POLICY IF EXISTS "用户可以更新自己项目的角色" ON public.project_roles;
CREATE POLICY "用户可以更新自己项目的角色"
  ON public.project_roles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
       WHERE projects.id = project_roles.project_id
         AND projects.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
       WHERE projects.id = project_roles.project_id
         AND projects.created_by = auth.uid()
    )
  );

-- 兼容 commit_presales_execution：它会完整保存 breakdown，触发器从中提取
-- 新增的版本化配置，避免复制整段执行生命周期 RPC。
CREATE OR REPLACE FUNCTION public.populate_cost_snapshot_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF jsonb_typeof(NEW.breakdown) = 'object'
     AND jsonb_typeof(NEW.breakdown->'ruleVersion') = 'string'
     AND NULLIF(BTRIM(NEW.breakdown->>'ruleVersion'), '') IS NOT NULL THEN
    NEW.rule_version := BTRIM(NEW.breakdown->>'ruleVersion');
  END IF;
  IF jsonb_typeof(NEW.breakdown) = 'object'
     AND jsonb_typeof(NEW.breakdown->'servicePolicyVersion') = 'string'
     AND NULLIF(BTRIM(NEW.breakdown->>'servicePolicyVersion'), '') IS NOT NULL THEN
    NEW.service_policy_version := BTRIM(NEW.breakdown->>'servicePolicyVersion');
  END IF;
  IF jsonb_typeof(NEW.breakdown) = 'object'
     AND jsonb_typeof(NEW.breakdown->'currency') = 'string'
     AND NULLIF(BTRIM(NEW.breakdown->>'currency'), '') IS NOT NULL THEN
    NEW.currency := UPPER(BTRIM(NEW.breakdown->>'currency'));
  END IF;
  IF jsonb_typeof(NEW.breakdown) = 'object'
     AND jsonb_typeof(NEW.breakdown->'laborCostPerDay') = 'number'
     AND (NEW.breakdown->>'laborCostPerDay')::DECIMAL > 0 THEN
    NEW.labor_cost_per_day := (NEW.breakdown->>'laborCostPerDay')::DECIMAL;
  END IF;
  IF jsonb_typeof(NEW.breakdown) = 'object'
     AND jsonb_typeof(NEW.breakdown->'workingHoursPerDay') = 'number'
     AND (NEW.breakdown->>'workingHoursPerDay')::DECIMAL > 0 THEN
    NEW.working_hours_per_day := (NEW.breakdown->>'workingHoursPerDay')::DECIMAL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS populate_cost_snapshot_metadata ON public.cost_estimates;
CREATE TRIGGER populate_cost_snapshot_metadata
  BEFORE INSERT OR UPDATE ON public.cost_estimates
  FOR EACH ROW EXECUTE FUNCTION public.populate_cost_snapshot_metadata();

-- 正式估算只允许通过先锁项目行的事务入口推进版本，避免 cost -> project 的反向锁。
DROP TRIGGER IF EXISTS bump_project_estimate_revision ON public.cost_estimates;
DROP FUNCTION IF EXISTS public.bump_project_estimate_revision();

CREATE OR REPLACE FUNCTION public.get_formal_project_cost_aggregate(
  p_project_id UUID
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'revision', p.estimate_revision,
    'functions', COALESCE((
      SELECT jsonb_agg(to_jsonb(fm) ORDER BY fm.created_at, fm.id)
        FROM public.function_modules fm
       WHERE fm.project_id = p.id
    ), '[]'::jsonb),
    'roles', COALESCE((
      SELECT jsonb_agg(to_jsonb(pr) ORDER BY pr.created_at, pr.id)
        FROM public.project_roles pr
       WHERE pr.project_id = p.id
    ), '[]'::jsonb),
    'additionalWork', COALESCE((
      SELECT jsonb_agg(to_jsonb(awi) ORDER BY awi.created_at, awi.id)
        FROM public.additional_work_items awi
       WHERE awi.project_id = p.id
    ), '[]'::jsonb),
    'costConfig', (
      SELECT to_jsonb(cost_snapshot)
        FROM (
          SELECT ce.id, ce.rule_version, ce.currency, ce.labor_cost_per_day,
                 ce.working_hours_per_day, ce.buffer_coefficient
            FROM public.cost_estimates ce
           WHERE ce.project_id = p.id
           ORDER BY ce.created_at DESC, ce.id DESC
           LIMIT 1
        ) cost_snapshot
    )
  )
    FROM public.projects p
   WHERE p.id = p_project_id
     AND p.created_by = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_formal_project_cost_aggregate(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_formal_project_cost_aggregate(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_formal_project_cost_aggregate(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.commit_manual_cost_recalculation(
  p_project_id UUID,
  p_expected_revision BIGINT,
  p_functions JSONB,
  p_project_roles JSONB,
  p_cost_estimate_id UUID,
  p_cost_estimate JSONB
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_revision BIGINT;
  v_item JSONB;
  v_seen_function_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  SELECT p.estimate_revision
    INTO v_revision
    FROM public.projects p
   WHERE p.id = p_project_id
     AND p.created_by = auth.uid()
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '项目不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;

  IF p_expected_revision IS NULL
     OR v_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION '估算版本冲突' USING ERRCODE = '40001';
  END IF;

  IF jsonb_typeof(p_functions) <> 'array'
     OR jsonb_typeof(p_project_roles) <> 'array'
     OR jsonb_typeof(p_cost_estimate) <> 'object' THEN
    RAISE EXCEPTION '人工重算快照结构无效' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cost_estimates ce
     WHERE ce.id = p_cost_estimate_id
       AND ce.project_id = p_project_id
     FOR UPDATE
  ) THEN
    RAISE EXCEPTION '成本快照不存在或不属于该项目' USING ERRCODE = '23503';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_functions)
  LOOP
    IF NULLIF(v_item->>'id', '') IS NULL THEN
      RAISE EXCEPTION '功能 ID 不能为空' USING ERRCODE = '22023';
    END IF;

    v_seen_function_ids := array_append(v_seen_function_ids, (v_item->>'id')::UUID);

    UPDATE public.function_modules
       SET estimated_hours = (v_item->>'estimated_hours')::DECIMAL,
           role_estimates = COALESCE(v_item->'role_estimates', '[]'::jsonb)
     WHERE id = (v_item->>'id')::UUID
       AND project_id = p_project_id;

    IF NOT FOUND THEN
      INSERT INTO public.function_modules (
        id, project_id, module_name, function_name, description, difficulty_level,
        estimated_hours, dependencies, role_estimates, is_verified
      ) VALUES (
        (v_item->>'id')::UUID,
        p_project_id,
        v_item->>'module_name',
        v_item->>'function_name',
        NULLIF(v_item->>'description', ''),
        v_item->>'difficulty_level',
        (v_item->>'estimated_hours')::DECIMAL,
        CASE
          WHEN v_item->'dependencies' IS NULL OR v_item->'dependencies' = 'null'::jsonb THEN NULL
          ELSE ARRAY(SELECT jsonb_array_elements_text(v_item->'dependencies'))
        END,
        COALESCE(v_item->'role_estimates', '[]'::jsonb),
        COALESCE((v_item->>'is_verified')::BOOLEAN, FALSE)
      );
    END IF;
  END LOOP;

  IF cardinality(v_seen_function_ids) = 0 THEN
    DELETE FROM public.function_modules WHERE project_id = p_project_id;
  ELSE
    DELETE FROM public.function_modules
     WHERE project_id = p_project_id
       AND NOT (id = ANY(v_seen_function_ids));
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_project_roles)
  LOOP
    UPDATE public.project_roles
       SET headcount = (v_item->>'headcount')::INTEGER,
           total_days = (v_item->>'total_days')::DECIMAL
     WHERE id = (v_item->>'id')::UUID
       AND project_id = p_project_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '角色不存在或不属于该项目: %', v_item->>'id' USING ERRCODE = '23503';
    END IF;
  END LOOP;

  v_item := p_cost_estimate;
  UPDATE public.cost_estimates
     SET labor_cost = (v_item->>'labor_cost')::DECIMAL,
         service_cost = (v_item->>'service_cost')::DECIMAL,
         infrastructure_cost = (v_item->>'infrastructure_cost')::DECIMAL,
         buffer_percentage = (v_item->>'buffer_percentage')::DECIMAL,
         total_cost = (v_item->>'total_cost')::DECIMAL,
         base_days = (v_item->>'base_days')::DECIMAL,
         buffered_days = (v_item->>'buffered_days')::DECIMAL,
         buffer_coefficient = (v_item->>'buffer_coefficient')::DECIMAL,
         rule_version = v_item->>'rule_version',
         service_policy_version = v_item->>'service_policy_version',
         currency = v_item->>'currency',
         labor_cost_per_day = (v_item->>'labor_cost_per_day')::DECIMAL,
         working_hours_per_day = (v_item->>'working_hours_per_day')::DECIMAL,
         breakdown = COALESCE(v_item->'breakdown', '{}'::jsonb)
   WHERE id = p_cost_estimate_id
     AND project_id = p_project_id;

  UPDATE public.projects
     SET estimate_revision = estimate_revision + 1
   WHERE id = p_project_id
   RETURNING estimate_revision INTO v_revision;

  RETURN v_revision;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_manual_cost_recalculation(UUID, BIGINT, JSONB, JSONB, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_manual_cost_recalculation(UUID, BIGINT, JSONB, JSONB, UUID, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.commit_manual_cost_recalculation(UUID, BIGINT, JSONB, JSONB, UUID, JSONB) TO authenticated;
