-- 将正式估算绑定到不可变需求基线，并以 append-only 版本保存工作流结果

ALTER TABLE public.projects
  ADD COLUMN latest_estimate_version_id UUID,
  ADD COLUMN published_estimate_version_id UUID;

-- 初始人工需求也必须先发布为不可变基线；只有会议变更生成的后续基线需要变更集。
ALTER TABLE public.requirement_baselines
  ALTER COLUMN applied_change_set_id DROP NOT NULL,
  ADD CONSTRAINT requirement_baselines_source_check CHECK (
    (applied_change_set_id IS NULL
      AND parent_baseline_id IS NULL
      AND source_requirement_id IS NOT NULL
      AND source_meeting_id IS NULL
      AND source_transcript_revision_id IS NULL
      AND source_analysis_version_id IS NULL)
    OR applied_change_set_id IS NOT NULL
  );

ALTER TABLE public.agent_executions
  ADD COLUMN requirement_baseline_id UUID,
  ADD COLUMN requirement_baseline_content_hash TEXT,
  ADD COLUMN estimate_version_id UUID,
  ADD COLUMN system_config_snapshot JSONB,
  ADD COLUMN model_id TEXT,
  ADD COLUMN workflow_version TEXT,
  ADD COLUMN prompt_versions JSONB,
  ADD COLUMN output_schema_version TEXT,
  ADD COLUMN requested_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.agent_executions
  ADD CONSTRAINT agent_executions_project_unique UNIQUE (id, project_id),
  ADD CONSTRAINT agent_executions_baseline_hash_check
    CHECK (
      requirement_baseline_content_hash IS NULL
      OR requirement_baseline_content_hash ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT agent_executions_baseline_fk
    FOREIGN KEY (requirement_baseline_id, project_id)
    REFERENCES public.requirement_baselines(id, project_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX idx_agent_executions_requirement_baseline
  ON public.agent_executions(requirement_baseline_id)
  WHERE requirement_baseline_id IS NOT NULL;
CREATE UNIQUE INDEX uq_agent_executions_presales_orchestration_run
  ON public.agent_executions ((input_data->>'orchestrationRunId'))
  WHERE agent_type = 'presales_estimation'
    AND input_data->>'orchestrationRunId' IS NOT NULL
    AND status IN ('running', 'completed');

CREATE TABLE public.estimate_versions (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  revision_no BIGINT NOT NULL CHECK (revision_no > 0),
  parent_version_id UUID,
  requirement_baseline_id UUID NOT NULL,
  requirement_baseline_content_hash TEXT NOT NULL
    CHECK (requirement_baseline_content_hash ~ '^[0-9a-f]{64}$'),
  agent_execution_id UUID,
  generation_kind TEXT NOT NULL DEFAULT 'ai_workflow'
    CHECK (generation_kind IN ('ai_workflow', 'manual_revision')),
  input_snapshot JSONB NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  system_config_snapshot JSONB NOT NULL
    CHECK (jsonb_typeof(system_config_snapshot) = 'object'),
  parsed_requirement JSONB NOT NULL
    CHECK (jsonb_typeof(parsed_requirement) = 'object'),
  output_snapshot JSONB NOT NULL CHECK (jsonb_typeof(output_snapshot) = 'object'),
  snapshot_hash TEXT NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  model_id TEXT NOT NULL CHECK (char_length(btrim(model_id)) BETWEEN 1 AND 200),
  workflow_version TEXT NOT NULL
    CHECK (char_length(btrim(workflow_version)) BETWEEN 1 AND 100),
  prompt_versions JSONB NOT NULL CHECK (jsonb_typeof(prompt_versions) = 'object'),
  output_schema_version TEXT NOT NULL
    CHECK (char_length(btrim(output_schema_version)) BETWEEN 1 AND 100),
  cost_rule_version TEXT NOT NULL
    CHECK (char_length(btrim(cost_rule_version)) BETWEEN 1 AND 100),
  service_policy_version TEXT NOT NULL
    CHECK (char_length(btrim(service_policy_version)) BETWEEN 1 AND 100),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, revision_no),
  UNIQUE (id, project_id),
  UNIQUE (agent_execution_id),
  UNIQUE (agent_execution_id, project_id),
  CHECK (
    (generation_kind = 'ai_workflow' AND agent_execution_id IS NOT NULL)
    OR (generation_kind = 'manual_revision' AND agent_execution_id IS NULL)
  ),
  CONSTRAINT estimate_versions_parent_fk
    FOREIGN KEY (parent_version_id, project_id)
    REFERENCES public.estimate_versions(id, project_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT estimate_versions_baseline_fk
    FOREIGN KEY (requirement_baseline_id, project_id)
    REFERENCES public.requirement_baselines(id, project_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT estimate_versions_execution_fk
    FOREIGN KEY (agent_execution_id, project_id)
    REFERENCES public.agent_executions(id, project_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE public.estimate_version_functions (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  estimate_version_id UUID NOT NULL,
  project_id UUID NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 0),
  module_name TEXT NOT NULL CHECK (char_length(btrim(module_name)) BETWEEN 1 AND 200),
  function_name TEXT NOT NULL CHECK (char_length(btrim(function_name)) BETWEEN 1 AND 200),
  description TEXT,
  difficulty_level TEXT NOT NULL
    CHECK (difficulty_level IN ('simple', 'medium', 'complex', 'very_complex')),
  estimated_hours DECIMAL(12, 2) NOT NULL CHECK (estimated_hours >= 0),
  dependencies TEXT[],
  role_estimates JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(role_estimates) = 'array'),
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (estimate_version_id, sequence_no),
  UNIQUE (id, estimate_version_id),
  CONSTRAINT estimate_version_functions_version_fk
    FOREIGN KEY (estimate_version_id, project_id)
    REFERENCES public.estimate_versions(id, project_id) ON DELETE CASCADE
);

CREATE TABLE public.estimate_version_roles (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  estimate_version_id UUID NOT NULL,
  project_id UUID NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 0),
  role_name TEXT NOT NULL CHECK (char_length(btrim(role_name)) BETWEEN 1 AND 200),
  responsibility TEXT,
  headcount INTEGER NOT NULL CHECK (headcount > 0),
  total_days DECIMAL(12, 2) NOT NULL CHECK (total_days >= 0),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (estimate_version_id, sequence_no),
  CONSTRAINT estimate_version_roles_version_fk
    FOREIGN KEY (estimate_version_id, project_id)
    REFERENCES public.estimate_versions(id, project_id) ON DELETE CASCADE
);

CREATE TABLE public.estimate_version_additional_work (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  estimate_version_id UUID NOT NULL,
  project_id UUID NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 0),
  work_item TEXT NOT NULL CHECK (char_length(btrim(work_item)) BETWEEN 1 AND 300),
  days DECIMAL(12, 2) NOT NULL CHECK (days >= 0),
  assigned_roles TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (estimate_version_id, sequence_no),
  CONSTRAINT estimate_version_additional_work_version_fk
    FOREIGN KEY (estimate_version_id, project_id)
    REFERENCES public.estimate_versions(id, project_id) ON DELETE CASCADE
);

CREATE TABLE public.estimate_version_costs (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  estimate_version_id UUID NOT NULL,
  project_id UUID NOT NULL,
  labor_cost DECIMAL(14, 2) NOT NULL CHECK (labor_cost >= 0),
  service_cost DECIMAL(14, 2) NOT NULL CHECK (service_cost >= 0),
  infrastructure_cost DECIMAL(14, 2) NOT NULL CHECK (infrastructure_cost >= 0),
  buffer_percentage DECIMAL(8, 4) NOT NULL CHECK (buffer_percentage >= 0),
  total_cost DECIMAL(14, 2) NOT NULL CHECK (total_cost >= 0),
  base_days DECIMAL(12, 2) NOT NULL CHECK (base_days >= 0),
  buffered_days DECIMAL(12, 2) NOT NULL CHECK (buffered_days >= 0),
  buffer_coefficient DECIMAL(8, 4) NOT NULL CHECK (buffer_coefficient > 0),
  rule_version TEXT NOT NULL,
  service_policy_version TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (char_length(btrim(currency)) BETWEEN 1 AND 20),
  labor_cost_per_day DECIMAL(14, 2) NOT NULL CHECK (labor_cost_per_day > 0),
  working_hours_per_day DECIMAL(8, 2) NOT NULL CHECK (working_hours_per_day > 0),
  breakdown JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(breakdown) = 'object'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (estimate_version_id),
  UNIQUE (id, estimate_version_id),
  CONSTRAINT estimate_version_costs_version_fk
    FOREIGN KEY (estimate_version_id, project_id)
    REFERENCES public.estimate_versions(id, project_id) ON DELETE CASCADE
);

ALTER TABLE public.agent_executions
  ADD CONSTRAINT agent_executions_estimate_version_fk
    FOREIGN KEY (estimate_version_id, project_id)
    REFERENCES public.estimate_versions(id, project_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_latest_estimate_version_fk
    FOREIGN KEY (latest_estimate_version_id, id)
    REFERENCES public.estimate_versions(id, project_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT projects_published_estimate_version_fk
    FOREIGN KEY (published_estimate_version_id, id)
    REFERENCES public.estimate_versions(id, project_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX idx_estimate_versions_project
  ON public.estimate_versions(project_id, revision_no DESC);
CREATE INDEX idx_estimate_versions_baseline
  ON public.estimate_versions(requirement_baseline_id, created_at DESC);
CREATE INDEX idx_estimate_version_functions_version
  ON public.estimate_version_functions(estimate_version_id, sequence_no);
CREATE INDEX idx_estimate_version_roles_version
  ON public.estimate_version_roles(estimate_version_id, sequence_no);
CREATE INDEX idx_estimate_version_additional_work_version
  ON public.estimate_version_additional_work(estimate_version_id, sequence_no);

ALTER TABLE public.estimate_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_version_functions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_version_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_version_additional_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_version_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户可以查看自己项目的估算版本"
  ON public.estimate_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = estimate_versions.project_id AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以查看自己项目的估算功能"
  ON public.estimate_version_functions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = estimate_version_functions.project_id AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以查看自己项目的估算角色"
  ON public.estimate_version_roles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = estimate_version_roles.project_id AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以查看自己项目的估算额外工作"
  ON public.estimate_version_additional_work FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = estimate_version_additional_work.project_id AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以查看自己项目的估算成本"
  ON public.estimate_version_costs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = estimate_version_costs.project_id AND p.created_by = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.protect_immutable_estimate_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id
    ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION '估算版本及其明细不可修改或删除' USING ERRCODE = '55000';
  END IF;

  IF TG_TABLE_NAME = 'estimate_versions'
     AND NEW.id = OLD.id
     AND NEW.project_id = OLD.project_id
     AND NEW.revision_no = OLD.revision_no
     AND NEW.parent_version_id IS NOT DISTINCT FROM OLD.parent_version_id
     AND NEW.requirement_baseline_id = OLD.requirement_baseline_id
     AND NEW.requirement_baseline_content_hash = OLD.requirement_baseline_content_hash
     AND NEW.agent_execution_id IS NOT DISTINCT FROM OLD.agent_execution_id
     AND NEW.generation_kind = OLD.generation_kind
     AND NEW.input_snapshot = OLD.input_snapshot
     AND NEW.system_config_snapshot = OLD.system_config_snapshot
     AND NEW.parsed_requirement = OLD.parsed_requirement
     AND NEW.output_snapshot = OLD.output_snapshot
     AND NEW.snapshot_hash = OLD.snapshot_hash
     AND NEW.model_id = OLD.model_id
     AND NEW.workflow_version = OLD.workflow_version
     AND NEW.prompt_versions = OLD.prompt_versions
     AND NEW.output_schema_version = OLD.output_schema_version
     AND NEW.cost_rule_version = OLD.cost_rule_version
     AND NEW.service_policy_version = OLD.service_policy_version
     AND NEW.created_by = OLD.created_by
     AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION '估算版本及其明细不可修改或删除' USING ERRCODE = '55000';
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

CREATE OR REPLACE FUNCTION public.protect_project_requirement_baseline_pointer()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.current_requirement_baseline_id IS DISTINCT FROM OLD.current_requirement_baseline_id
     AND current_user NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    RAISE EXCEPTION '项目当前需求基线只能通过受控事务更新' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_estimate_version_lineage()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.revision_no = 1 AND NEW.parent_version_id IS NOT NULL THEN
    RAISE EXCEPTION '首个估算版本不能包含父版本' USING ERRCODE = '23514';
  END IF;
  IF NEW.revision_no > 1 AND NEW.parent_version_id IS NULL THEN
    RAISE EXCEPTION '后续估算版本必须包含父版本' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.estimate_versions parent
     WHERE parent.id = NEW.parent_version_id
       AND parent.project_id = NEW.project_id
       AND parent.revision_no = NEW.revision_no - 1
  ) THEN
    RAISE EXCEPTION '估算父版本必须是同项目的前一版本' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_project_estimate_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (NEW.latest_estimate_version_id IS DISTINCT FROM OLD.latest_estimate_version_id
      OR NEW.published_estimate_version_id IS DISTINCT FROM OLD.published_estimate_version_id
      OR NEW.estimate_revision IS DISTINCT FROM OLD.estimate_revision)
     AND current_user NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    RAISE EXCEPTION '项目估算版本状态只能通过受控估算事务更新' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_estimate_version_lineage
BEFORE INSERT ON public.estimate_versions
FOR EACH ROW EXECUTE FUNCTION public.validate_estimate_version_lineage();
CREATE TRIGGER protect_estimate_versions
BEFORE UPDATE OR DELETE ON public.estimate_versions
FOR EACH ROW EXECUTE FUNCTION public.protect_immutable_estimate_row();
CREATE TRIGGER protect_estimate_version_functions
BEFORE UPDATE OR DELETE ON public.estimate_version_functions
FOR EACH ROW EXECUTE FUNCTION public.protect_immutable_estimate_row();
CREATE TRIGGER protect_estimate_version_roles
BEFORE UPDATE OR DELETE ON public.estimate_version_roles
FOR EACH ROW EXECUTE FUNCTION public.protect_immutable_estimate_row();
CREATE TRIGGER protect_estimate_version_additional_work
BEFORE UPDATE OR DELETE ON public.estimate_version_additional_work
FOR EACH ROW EXECUTE FUNCTION public.protect_immutable_estimate_row();
CREATE TRIGGER protect_estimate_version_costs
BEFORE UPDATE OR DELETE ON public.estimate_version_costs
FOR EACH ROW EXECUTE FUNCTION public.protect_immutable_estimate_row();
CREATE TRIGGER protect_agent_execution_provenance
BEFORE UPDATE ON public.agent_executions
FOR EACH ROW EXECUTE FUNCTION public.protect_agent_execution_provenance();
CREATE TRIGGER protect_project_estimate_state
BEFORE UPDATE OF latest_estimate_version_id, published_estimate_version_id, estimate_revision
ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.protect_project_estimate_state();

CREATE OR REPLACE FUNCTION public.publish_initial_requirement_baseline(
  p_project_id UUID,
  p_requirement_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_requirement public.requirements%ROWTYPE;
  v_baseline_id UUID;
  v_snapshot JSONB;
  v_canonical_content TEXT;
  v_content_hash TEXT;
BEGIN
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION '仅登录用户可以发布需求基线' USING ERRCODE = '42501';
  END IF;

  SELECT p.* INTO v_project
    FROM public.projects p
   WHERE p.id = p_project_id AND p.created_by = auth.uid()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '项目不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;
  IF v_project.status = 'archived' THEN
    RAISE EXCEPTION '归档项目不能发布需求基线' USING ERRCODE = 'P0001';
  END IF;

  IF v_project.current_requirement_baseline_id IS NOT NULL THEN
    SELECT rb.id INTO v_baseline_id
      FROM public.requirement_baselines rb
     WHERE rb.id = v_project.current_requirement_baseline_id
       AND rb.project_id = v_project.id
       AND rb.source_requirement_id = p_requirement_id
       AND rb.parent_baseline_id IS NULL
       AND rb.applied_change_set_id IS NULL;
    IF FOUND THEN RETURN v_baseline_id; END IF;
    RAISE EXCEPTION '项目已有已确认需求基线；后续变更必须通过需求变更集应用' USING ERRCODE = '55000';
  END IF;

  SELECT r.* INTO v_requirement
    FROM public.requirements r
   WHERE r.id = p_requirement_id AND r.project_id = v_project.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '需求不存在或不属于该项目' USING ERRCODE = '23503';
  END IF;

  v_canonical_content := COALESCE(
    NULLIF(pg_catalog.btrim(v_requirement.raw_content), ''),
    NULLIF(pg_catalog.btrim(COALESCE(v_project.description, '')), '')
  );
  IF v_canonical_content IS NULL THEN
    RAISE EXCEPTION '需求内容为空，不能发布基线' USING ERRCODE = '22023';
  END IF;

  v_snapshot := pg_catalog.jsonb_build_object(
    'schemaVersion', 'requirement-baseline-v1',
    'projectDescription', COALESCE(v_project.description, ''),
    'sourceRequirement', pg_catalog.jsonb_build_object(
      'id', v_requirement.id,
      'rawContent', v_canonical_content,
      'parsedContent', COALESCE(v_requirement.parsed_content, 'null'::jsonb)
    ),
    'sections', pg_catalog.jsonb_build_object(
      'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', 'source-requirement-' || v_requirement.id::TEXT,
        'title', '原始需求',
        'content', v_canonical_content,
        'kind', 'source',
        'sourceRequirementId', v_requirement.id
      )),
      'business_goals', '[]'::jsonb,
      'key_features', '[]'::jsonb,
      'tech_stack', '[]'::jsonb,
      'non_functional_requirements', '[]'::jsonb,
      'risks', '[]'::jsonb,
      'decisions', '[]'::jsonb,
      'action_items', '[]'::jsonb,
      'conflicts', '[]'::jsonb,
      'open_questions', '[]'::jsonb,
      'out_of_scope', '[]'::jsonb
    ),
    'appliedChangeSets', '[]'::jsonb
  );
  IF NOT public.is_requirement_baseline_snapshot_v1(v_snapshot) THEN
    RAISE EXCEPTION '需求基线快照无效' USING ERRCODE = '23514';
  END IF;

  v_content_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_canonical_content, 'UTF8'), 'sha256'),
    'hex'
  );

  INSERT INTO public.requirement_baselines (
    project_id, revision_no, parent_baseline_id, source_requirement_id,
    applied_change_set_id, canonical_content, content_hash, snapshot,
    project_description_snapshot, created_by
  ) VALUES (
    v_project.id, 1, NULL, v_requirement.id, NULL, v_canonical_content,
    v_content_hash, v_snapshot, COALESCE(v_project.description, ''), auth.uid()
  ) RETURNING id INTO v_baseline_id;

  UPDATE public.projects
     SET current_requirement_baseline_id = v_baseline_id
   WHERE id = v_project.id;

  RETURN v_baseline_id;
END;
$$;

-- 历史正式聚合只有“当前状态”而没有可恢复的逐版快照。迁移时将当前状态诚实地
-- 导入为 revision 1 的 genesis manual_revision，并保留旧 revision 作为来源元数据。
DO $$
DECLARE
  v_source RECORD;
  v_baseline_id UUID;
  v_version_id UUID;
  v_snapshot JSONB;
  v_parsed_requirement JSONB;
  v_functions JSONB;
  v_roles JSONB;
  v_additional_work JSONB;
  v_cost JSONB;
  v_output_snapshot JSONB;
  v_snapshot_hash TEXT;
BEGIN
  UPDATE public.projects p
     SET current_requirement_baseline_id = (
       SELECT rb.id
         FROM public.requirement_baselines rb
        WHERE rb.project_id = p.id
        ORDER BY rb.revision_no DESC
        LIMIT 1
     )
   WHERE p.current_requirement_baseline_id IS NULL
     AND EXISTS (
       SELECT 1 FROM public.requirement_baselines rb WHERE rb.project_id = p.id
     );

  FOR v_source IN
    SELECT p.id AS project_id, p.created_by, COALESCE(p.description, '') AS description,
           r.id AS requirement_id, r.raw_content, r.parsed_content,
           COALESCE(
             NULLIF(pg_catalog.btrim(r.raw_content), ''),
             NULLIF(pg_catalog.btrim(COALESCE(p.description, '')), '')
           ) AS canonical_content
      FROM public.projects p
      JOIN LATERAL (
        SELECT req.*
          FROM public.requirements req
         WHERE req.project_id = p.id
         ORDER BY req.created_at DESC, req.id DESC
         LIMIT 1
      ) r ON TRUE
     WHERE p.current_requirement_baseline_id IS NULL
       AND p.created_by IS NOT NULL
       AND COALESCE(
         NULLIF(pg_catalog.btrim(r.raw_content), ''),
         NULLIF(pg_catalog.btrim(COALESCE(p.description, '')), '')
       ) IS NOT NULL
  LOOP
    v_snapshot := pg_catalog.jsonb_build_object(
      'schemaVersion', 'requirement-baseline-v1',
      'projectDescription', v_source.description,
      'sourceRequirement', pg_catalog.jsonb_build_object(
        'id', v_source.requirement_id,
        'rawContent', v_source.canonical_content,
        'parsedContent', COALESCE(v_source.parsed_content, 'null'::jsonb)
      ),
      'sections', pg_catalog.jsonb_build_object(
        'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'id', 'source-requirement-' || v_source.requirement_id::TEXT,
          'title', '原始需求',
          'content', v_source.canonical_content,
          'kind', 'source',
          'sourceRequirementId', v_source.requirement_id
        )),
        'business_goals', '[]'::jsonb,
        'key_features', '[]'::jsonb,
        'tech_stack', '[]'::jsonb,
        'non_functional_requirements', '[]'::jsonb,
        'risks', '[]'::jsonb,
        'decisions', '[]'::jsonb,
        'action_items', '[]'::jsonb,
        'conflicts', '[]'::jsonb,
        'open_questions', '[]'::jsonb,
        'out_of_scope', '[]'::jsonb
      ),
      'appliedChangeSets', '[]'::jsonb
    );

    INSERT INTO public.requirement_baselines (
      project_id, revision_no, parent_baseline_id, source_requirement_id,
      applied_change_set_id, canonical_content, content_hash, snapshot,
      project_description_snapshot, created_by
    ) VALUES (
      v_source.project_id, 1, NULL, v_source.requirement_id, NULL,
      v_source.canonical_content,
      pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        v_source.canonical_content, 'UTF8'
      ), 'sha256'), 'hex'),
      v_snapshot, v_source.description, v_source.created_by
    ) RETURNING id INTO v_baseline_id;

    UPDATE public.projects
       SET current_requirement_baseline_id = v_baseline_id
     WHERE id = v_source.project_id;
  END LOOP;

  FOR v_source IN
    SELECT p.*, rb.content_hash AS baseline_hash,
           rb.revision_no AS baseline_revision,
           rb.project_description_snapshot,
           rb.snapshot AS baseline_snapshot,
           ce.id AS legacy_cost_id,
           ce.labor_cost, ce.service_cost, ce.infrastructure_cost,
           ce.buffer_percentage, ce.total_cost, ce.base_days, ce.buffered_days,
           ce.buffer_coefficient, ce.rule_version, ce.service_policy_version,
           ce.currency, ce.labor_cost_per_day, ce.working_hours_per_day,
           ce.breakdown AS cost_breakdown
      FROM public.projects p
      JOIN public.requirement_baselines rb
        ON rb.id = p.current_requirement_baseline_id AND rb.project_id = p.id
      JOIN LATERAL (
        SELECT cost.*
          FROM public.cost_estimates cost
         WHERE cost.project_id = p.id
         ORDER BY cost.created_at DESC, cost.id DESC
         LIMIT 1
      ) ce ON TRUE
     WHERE p.latest_estimate_version_id IS NULL
       AND p.created_by IS NOT NULL
  LOOP
    v_parsed_requirement := COALESCE(
      CASE
        WHEN pg_catalog.jsonb_typeof(v_source.baseline_snapshot->'sourceRequirement'->'parsedContent') = 'object'
          THEN v_source.baseline_snapshot->'sourceRequirement'->'parsedContent'
      END,
      pg_catalog.jsonb_build_object(
        'projectType', '历史项目', 'businessGoals', '[]'::jsonb,
        'keyFeatures', '[]'::jsonb, 'techStack', '[]'::jsonb,
        'nonFunctionalRequirements', '{}'::jsonb, 'risks', '[]'::jsonb
      )
    );

    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'legacyId', fm.id,
      'module_name', LEFT(COALESCE(NULLIF(pg_catalog.btrim(fm.module_name), ''), '未命名模块'), 200),
      'function_name', LEFT(COALESCE(NULLIF(pg_catalog.btrim(fm.function_name), ''), '未命名功能'), 200),
      'description', fm.description,
      'difficulty_level', fm.difficulty_level,
      'estimated_hours', GREATEST(COALESCE(fm.estimated_hours, 0), 0),
      'dependencies', to_jsonb(fm.dependencies),
      'role_estimates', CASE WHEN pg_catalog.jsonb_typeof(fm.role_estimates) = 'array'
        THEN fm.role_estimates ELSE '[]'::jsonb END,
      'is_verified', COALESCE(fm.is_verified, FALSE)
    ) ORDER BY fm.created_at, fm.id), '[]'::jsonb)
      INTO v_functions
      FROM public.function_modules fm
     WHERE fm.project_id = v_source.id;

    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'legacyId', pr.id,
      'role_name', LEFT(COALESCE(NULLIF(pg_catalog.btrim(pr.role_name), ''), '未命名角色'), 200),
      'responsibility', pr.responsibility,
      'headcount', GREATEST(COALESCE(pr.headcount, 1), 1),
      'total_days', GREATEST(COALESCE(pr.total_days, 0), 0)
    ) ORDER BY pr.created_at, pr.id), '[]'::jsonb)
      INTO v_roles
      FROM public.project_roles pr
     WHERE pr.project_id = v_source.id;

    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'legacyId', awi.id,
      'work_item', LEFT(COALESCE(NULLIF(pg_catalog.btrim(awi.work_item), ''), '未命名额外工作'), 300),
      'days', GREATEST(COALESCE(awi.days, 0), 0),
      'assigned_roles', to_jsonb(COALESCE(awi.assigned_roles, '{}'::TEXT[]))
    ) ORDER BY awi.created_at, awi.id), '[]'::jsonb)
      INTO v_additional_work
      FROM public.additional_work_items awi
     WHERE awi.project_id = v_source.id;

    v_cost := pg_catalog.jsonb_build_object(
      'labor_cost', GREATEST(COALESCE(v_source.labor_cost, 0), 0),
      'service_cost', GREATEST(COALESCE(v_source.service_cost, 0), 0),
      'infrastructure_cost', GREATEST(COALESCE(v_source.infrastructure_cost, 0), 0),
      'buffer_percentage', GREATEST(COALESCE(v_source.buffer_percentage, 0), 0),
      'total_cost', GREATEST(COALESCE(v_source.total_cost, 0), 0),
      'base_days', GREATEST(COALESCE(v_source.base_days, 0), 0),
      'buffered_days', GREATEST(COALESCE(v_source.buffered_days, 0), 0),
      'buffer_coefficient', GREATEST(COALESCE(v_source.buffer_coefficient, 1), 0.0001),
      'rule_version', COALESCE(NULLIF(pg_catalog.btrim(v_source.rule_version), ''), 'legacy-formal-v0'),
      'service_policy_version', COALESCE(NULLIF(pg_catalog.btrim(v_source.service_policy_version), ''), 'legacy-service-v0'),
      'currency', COALESCE(NULLIF(pg_catalog.btrim(v_source.currency), ''), 'CNY'),
      'labor_cost_per_day', GREATEST(COALESCE(v_source.labor_cost_per_day, 1500), 0.01),
      'working_hours_per_day', GREATEST(COALESCE(v_source.working_hours_per_day, 8), 0.01),
      'breakdown', CASE WHEN pg_catalog.jsonb_typeof(v_source.cost_breakdown) = 'object'
        THEN v_source.cost_breakdown ELSE '{}'::jsonb END
    );
    v_output_snapshot := pg_catalog.jsonb_build_object(
      'generationKind', 'legacy_genesis_import',
      'parsedRequirement', v_parsed_requirement,
      'functionModules', v_functions,
      'projectRoles', v_roles,
      'additionalWorkItems', v_additional_work,
      'costEstimate', v_cost
    );
    v_snapshot_hash := pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(v_output_snapshot::TEXT, 'UTF8'), 'sha256'
    ), 'hex');

    INSERT INTO public.estimate_versions (
      project_id, revision_no, parent_version_id, requirement_baseline_id,
      requirement_baseline_content_hash, agent_execution_id, generation_kind,
      input_snapshot, system_config_snapshot, parsed_requirement, output_snapshot,
      snapshot_hash, model_id, workflow_version, prompt_versions,
      output_schema_version, cost_rule_version, service_policy_version, created_by
    ) VALUES (
      v_source.id, 1, NULL, v_source.current_requirement_baseline_id,
      v_source.baseline_hash, NULL, 'manual_revision',
      pg_catalog.jsonb_build_object(
        'migrationKind', 'legacy_genesis_import',
        'legacyEstimateRevision', v_source.estimate_revision,
        'legacyCostEstimateId', v_source.legacy_cost_id,
        'requirementBaselineId', v_source.current_requirement_baseline_id,
        'requirementBaselineRevision', v_source.baseline_revision,
        'requirementBaselineContentHash', v_source.baseline_hash,
        'projectDescriptionSnapshot', v_source.project_description_snapshot
      ),
      pg_catalog.jsonb_build_object(
        'currency', v_cost->>'currency',
        'laborCostPerDay', (v_cost->>'labor_cost_per_day')::DECIMAL,
        'workingHoursPerDay', (v_cost->>'working_hours_per_day')::DECIMAL,
        'bufferCoefficient', (v_cost->>'buffer_coefficient')::DECIMAL
      ),
      v_parsed_requirement, v_output_snapshot, v_snapshot_hash,
      'legacy-aggregate-import-v1', 'legacy-genesis-migration-v1', '{}'::jsonb,
      'presales-estimate-legacy-import-v1', v_cost->>'rule_version',
      v_cost->>'service_policy_version', v_source.created_by
    ) RETURNING id INTO v_version_id;

    INSERT INTO public.estimate_version_functions (
      estimate_version_id, project_id, sequence_no, module_name, function_name,
      description, difficulty_level, estimated_hours, dependencies, role_estimates,
      is_verified
    )
    SELECT v_version_id, v_source.id, ordinal - 1,
           item->>'module_name', item->>'function_name', NULLIF(item->>'description', ''),
           item->>'difficulty_level', (item->>'estimated_hours')::DECIMAL,
           CASE WHEN item->'dependencies' IS NULL OR item->'dependencies' = 'null'::jsonb
             THEN NULL ELSE ARRAY(SELECT pg_catalog.jsonb_array_elements_text(item->'dependencies')) END,
           item->'role_estimates', COALESCE((item->>'is_verified')::BOOLEAN, FALSE)
      FROM pg_catalog.jsonb_array_elements(v_functions) WITH ORDINALITY AS entries(item, ordinal);

    INSERT INTO public.estimate_version_roles (
      estimate_version_id, project_id, sequence_no, role_name,
      responsibility, headcount, total_days
    )
    SELECT v_version_id, v_source.id, ordinal - 1, item->>'role_name',
           NULLIF(item->>'responsibility', ''), (item->>'headcount')::INTEGER,
           (item->>'total_days')::DECIMAL
      FROM pg_catalog.jsonb_array_elements(v_roles) WITH ORDINALITY AS entries(item, ordinal);

    INSERT INTO public.estimate_version_additional_work (
      estimate_version_id, project_id, sequence_no, work_item, days, assigned_roles
    )
    SELECT v_version_id, v_source.id, ordinal - 1, item->>'work_item',
           (item->>'days')::DECIMAL,
           ARRAY(SELECT pg_catalog.jsonb_array_elements_text(item->'assigned_roles'))
      FROM pg_catalog.jsonb_array_elements(v_additional_work) WITH ORDINALITY AS entries(item, ordinal);

    INSERT INTO public.estimate_version_costs (
      estimate_version_id, project_id, labor_cost, service_cost, infrastructure_cost,
      buffer_percentage, total_cost, base_days, buffered_days, buffer_coefficient,
      rule_version, service_policy_version, currency, labor_cost_per_day,
      working_hours_per_day, breakdown
    ) VALUES (
      v_version_id, v_source.id, (v_cost->>'labor_cost')::DECIMAL,
      (v_cost->>'service_cost')::DECIMAL, (v_cost->>'infrastructure_cost')::DECIMAL,
      (v_cost->>'buffer_percentage')::DECIMAL, (v_cost->>'total_cost')::DECIMAL,
      (v_cost->>'base_days')::DECIMAL, (v_cost->>'buffered_days')::DECIMAL,
      (v_cost->>'buffer_coefficient')::DECIMAL, v_cost->>'rule_version',
      v_cost->>'service_policy_version', v_cost->>'currency',
      (v_cost->>'labor_cost_per_day')::DECIMAL,
      (v_cost->>'working_hours_per_day')::DECIMAL, v_cost->'breakdown'
    );

    UPDATE public.projects
       SET latest_estimate_version_id = v_version_id,
           estimate_revision = 1
     WHERE id = v_source.id;
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.begin_presales_execution(UUID, UUID, TEXT, JSONB);
CREATE FUNCTION public.begin_presales_execution(
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
  v_recovered_status TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以启动售前分析' USING ERRCODE = '42501';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION '缺少执行发起用户' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_input_data, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(p_system_config) <> 'object'
     OR jsonb_typeof(p_prompt_versions) <> 'object'
     OR NULLIF(btrim(p_model_id), '') IS NULL
     OR NULLIF(btrim(p_workflow_version), '') IS NULL
     OR NULLIF(btrim(p_output_schema_version), '') IS NULL THEN
    RAISE EXCEPTION '执行输入快照或版本信息无效' USING ERRCODE = '22023';
  END IF;

  SELECT p.* INTO v_project
    FROM public.projects p
   WHERE p.id = p_project_id AND p.created_by = p_actor_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '项目不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;
  IF v_project.status = 'archived' THEN
    RAISE EXCEPTION '归档项目不能执行分析' USING ERRCODE = 'P0001';
  END IF;
  IF v_project.current_requirement_baseline_id IS DISTINCT FROM p_requirement_baseline_id THEN
    RAISE EXCEPTION '请求的需求基线不是项目当前已确认基线' USING ERRCODE = '40001';
  END IF;

  SELECT rb.* INTO v_baseline
    FROM public.requirement_baselines rb
   WHERE rb.id = p_requirement_baseline_id AND rb.project_id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '需求基线不存在或与项目不匹配' USING ERRCODE = '23503';
  END IF;

  IF NULLIF(pg_catalog.btrim(COALESCE(p_input_data->>'orchestrationRunId', '')), '') IS NOT NULL THEN
    SELECT ae.id INTO v_execution_id
      FROM public.agent_executions ae
     WHERE ae.agent_type = 'presales_estimation'
       AND ae.input_data->>'orchestrationRunId' = p_input_data->>'orchestrationRunId'
       AND ae.project_id = p_project_id
       AND ae.requested_by = p_actor_user_id
       AND ae.requirement_baseline_id = p_requirement_baseline_id
       AND ae.status IN ('running', 'completed')
     LIMIT 1;
    IF FOUND THEN RETURN v_execution_id; END IF;
  END IF;

  v_recovered_status := NULL;
  SELECT CASE
           WHEN ae.input_data->>'previousProjectStatus' IN ('draft', 'completed')
             THEN ae.input_data->>'previousProjectStatus'
           ELSE 'draft'
         END
    INTO v_recovered_status
    FROM public.agent_executions ae
   WHERE ae.project_id = p_project_id
     AND ae.status = 'running'
     AND ae.created_at < NOW() - INTERVAL '10 minutes'
   ORDER BY ae.created_at DESC
   LIMIT 1;

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

  IF v_project.status = 'analyzing' AND v_recovered_status IS NOT NULL THEN
    v_project.status := v_recovered_status;
    UPDATE public.projects SET status = v_project.status WHERE id = p_project_id;
  END IF;

  INSERT INTO public.agent_executions (
    project_id, requirement_id, requirement_baseline_id,
    requirement_baseline_content_hash, agent_type, input_data, status,
    system_config_snapshot, model_id, workflow_version, prompt_versions,
    output_schema_version, requested_by
  ) VALUES (
    p_project_id, v_baseline.source_requirement_id, v_baseline.id,
    v_baseline.content_hash, p_agent_type,
    COALESCE(p_input_data, '{}'::jsonb) || jsonb_build_object(
      'previousProjectStatus', v_project.status,
      'expectedEstimateVersionId', v_project.latest_estimate_version_id,
      'requirementBaselineId', v_baseline.id,
      'requirementBaselineRevision', v_baseline.revision_no,
      'requirementBaselineContentHash', v_baseline.content_hash
    ),
    'running', p_system_config, btrim(p_model_id), btrim(p_workflow_version),
    p_prompt_versions, btrim(p_output_schema_version), p_actor_user_id
  ) RETURNING id INTO v_execution_id;

  UPDATE public.projects SET status = 'analyzing' WHERE id = p_project_id;
  RETURN v_execution_id;
END;
$$;

DROP FUNCTION IF EXISTS public.commit_presales_execution(UUID, JSONB, INTEGER);
CREATE FUNCTION public.commit_presales_execution(
  p_actor_user_id UUID,
  p_execution_id UUID,
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
  v_item JSONB;
  v_sequence INTEGER;
  v_expected_version_id UUID;
  v_revision_no BIGINT;
  v_estimate_version_id UUID;
  v_output_snapshot JSONB;
  v_snapshot_hash TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以提交售前分析' USING ERRCODE = '42501';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION '缺少执行发起用户' USING ERRCODE = '22023';
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
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '执行记录关联项目已发生变化' USING ERRCODE = '40001';
  END IF;
  IF v_project.status = 'archived' THEN
    RAISE EXCEPTION '项目已归档，拒绝提交估算结果' USING ERRCODE = '40001';
  END IF;
  IF v_execution.status <> 'running' THEN
    RAISE EXCEPTION '执行记录状态不是 running: %', v_execution.status USING ERRCODE = 'P0001';
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
  IF NOT FOUND OR v_baseline.content_hash
       IS DISTINCT FROM v_execution.requirement_baseline_content_hash THEN
    RAISE EXCEPTION '执行绑定的需求基线来源无效' USING ERRCODE = '40001';
  END IF;

  BEGIN
    v_expected_version_id := NULLIF(
      v_execution.input_data->>'expectedEstimateVersionId',
      ''
    )::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION '执行记录的开始估算版本无效' USING ERRCODE = '22023';
  END;
  IF v_project.latest_estimate_version_id IS DISTINCT FROM v_expected_version_id THEN
    RAISE EXCEPTION '估算版本冲突' USING ERRCODE = '40001';
  END IF;

  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object'
     OR jsonb_typeof(p_snapshot->'parsedRequirement') <> 'object'
     OR jsonb_typeof(p_snapshot->'functionModules') <> 'array'
     OR jsonb_typeof(p_snapshot->'projectRoles') <> 'array'
     OR jsonb_typeof(p_snapshot->'additionalWorkItems') <> 'array'
     OR jsonb_typeof(p_snapshot->'costEstimate') <> 'object'
     OR jsonb_typeof(p_snapshot->'outputData') <> 'object' THEN
    RAISE EXCEPTION '持久化快照结构无效' USING ERRCODE = '22023';
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
    'workflowResult', p_snapshot->'outputData'
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
    jsonb_build_object(
      'requirementBaselineId', v_baseline.id,
      'requirementBaselineRevision', v_baseline.revision_no,
      'requirementBaselineContentHash', v_baseline.content_hash,
      'projectDescriptionSnapshot', v_baseline.project_description_snapshot
    ),
    v_execution.system_config_snapshot, p_snapshot->'parsedRequirement',
    v_output_snapshot, v_snapshot_hash, v_execution.model_id,
    v_execution.workflow_version, v_execution.prompt_versions,
    v_execution.output_schema_version,
    p_snapshot->'costEstimate'->>'rule_version',
    p_snapshot->'costEstimate'->>'service_policy_version', p_actor_user_id
  ) RETURNING id INTO v_estimate_version_id;

  v_sequence := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_snapshot->'functionModules') LOOP
    INSERT INTO public.estimate_version_functions (
      estimate_version_id, project_id, sequence_no, module_name, function_name,
      description, difficulty_level, estimated_hours, dependencies, role_estimates,
      is_verified
    ) VALUES (
      v_estimate_version_id, v_project.id, v_sequence,
      v_item->>'module_name', v_item->>'function_name', NULLIF(v_item->>'description', ''),
      v_item->>'difficulty_level', (v_item->>'estimated_hours')::DECIMAL,
      CASE WHEN v_item->'dependencies' IS NULL OR v_item->'dependencies' = 'null'::jsonb
        THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text(v_item->'dependencies')) END,
      COALESCE(v_item->'role_estimates', '[]'::jsonb), FALSE
    );
    v_sequence := v_sequence + 1;
  END LOOP;

  v_sequence := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_snapshot->'projectRoles') LOOP
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
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_snapshot->'additionalWorkItems') LOOP
    INSERT INTO public.estimate_version_additional_work (
      estimate_version_id, project_id, sequence_no, work_item, days, assigned_roles
    ) VALUES (
      v_estimate_version_id, v_project.id, v_sequence, v_item->>'work_item',
      (v_item->>'days')::DECIMAL,
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_item->'assigned_roles', '[]'::jsonb)))
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
         output_data = jsonb_build_object(
           'estimateVersionId', v_estimate_version_id,
           'snapshotHash', v_snapshot_hash,
           'result', p_snapshot->'outputData'
         ),
         error_message = NULL,
         execution_time_ms = GREATEST(COALESCE(p_execution_time_ms, 0), 0),
         completed_at = NOW()
   WHERE id = p_execution_id;

  UPDATE public.projects
     SET status = 'completed', latest_estimate_version_id = v_estimate_version_id,
         estimate_revision = v_revision_no
   WHERE id = v_project.id;

  RETURN v_estimate_version_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_formal_project_cost_aggregate(
  p_project_id UUID
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'revision', ev.revision_no,
    'estimateVersionId', ev.id,
    'functions', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(evf) ORDER BY evf.sequence_no)
        FROM public.estimate_version_functions evf
       WHERE evf.estimate_version_id = ev.id
    ), '[]'::jsonb),
    'roles', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(evr) ORDER BY evr.sequence_no)
        FROM public.estimate_version_roles evr
       WHERE evr.estimate_version_id = ev.id
    ), '[]'::jsonb),
    'additionalWork', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(evaw) ORDER BY evaw.sequence_no)
        FROM public.estimate_version_additional_work evaw
       WHERE evaw.estimate_version_id = ev.id
    ), '[]'::jsonb),
    'costConfig', (
      SELECT pg_catalog.jsonb_build_object(
        'id', evc.id,
        'rule_version', evc.rule_version,
        'currency', evc.currency,
        'labor_cost_per_day', evc.labor_cost_per_day,
        'working_hours_per_day', evc.working_hours_per_day,
        'buffer_coefficient', evc.buffer_coefficient
      )
        FROM public.estimate_version_costs evc
       WHERE evc.estimate_version_id = ev.id
    )
  )
    FROM public.projects p
    JOIN public.estimate_versions ev
      ON ev.id = p.latest_estimate_version_id AND ev.project_id = p.id
   WHERE p.id = p_project_id AND p.created_by = auth.uid();
$$;

DROP FUNCTION IF EXISTS public.commit_manual_cost_recalculation(
  UUID, BIGINT, JSONB, JSONB, UUID, JSONB
);
CREATE FUNCTION public.commit_manual_cost_recalculation(
  p_actor_user_id UUID,
  p_project_id UUID,
  p_expected_revision BIGINT,
  p_functions JSONB,
  p_project_roles JSONB,
  p_cost_estimate_id UUID,
  p_cost_estimate JSONB
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_parent public.estimate_versions%ROWTYPE;
  v_item JSONB;
  v_sequence INTEGER;
  v_revision_no BIGINT;
  v_estimate_version_id UUID;
  v_output_snapshot JSONB;
  v_snapshot_hash TEXT;
  v_additional_work JSONB;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以提交人工估算修订' USING ERRCODE = '42501';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION '缺少人工修订用户' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_typeof(p_functions) <> 'array'
     OR pg_catalog.jsonb_typeof(p_project_roles) <> 'array'
     OR pg_catalog.jsonb_typeof(p_cost_estimate) <> 'object' THEN
    RAISE EXCEPTION '人工重算快照结构无效' USING ERRCODE = '22023';
  END IF;

  SELECT p.* INTO v_project
    FROM public.projects p
   WHERE p.id = p_project_id AND p.created_by = p_actor_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '项目不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;
  IF v_project.status = 'archived' THEN
    RAISE EXCEPTION '归档项目不能创建人工估算修订' USING ERRCODE = 'P0001';
  END IF;
  IF v_project.latest_estimate_version_id IS NULL THEN
    RAISE EXCEPTION '项目尚无可修订的估算版本' USING ERRCODE = 'P0001';
  END IF;

  SELECT ev.* INTO v_parent
    FROM public.estimate_versions ev
   WHERE ev.id = v_project.latest_estimate_version_id
     AND ev.project_id = v_project.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '项目最新估算版本指针无效' USING ERRCODE = '40001';
  END IF;
  IF v_parent.requirement_baseline_id
       IS DISTINCT FROM v_project.current_requirement_baseline_id THEN
    RAISE EXCEPTION '当前估算基于旧需求基线，请先重新生成估算' USING ERRCODE = '40001';
  END IF;
  IF p_expected_revision IS NULL
     OR v_parent.revision_no IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION '估算版本冲突' USING ERRCODE = '40001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.estimate_version_costs evc
     WHERE evc.id = p_cost_estimate_id
       AND evc.estimate_version_id = v_parent.id
       AND evc.project_id = v_project.id
  ) THEN
    RAISE EXCEPTION '成本快照不存在或不属于当前估算版本' USING ERRCODE = '23503';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'work_item', work.work_item,
    'days', work.days,
    'assigned_roles', work.assigned_roles
  ) ORDER BY work.sequence_no), '[]'::jsonb)
    INTO v_additional_work
    FROM public.estimate_version_additional_work work
   WHERE work.estimate_version_id = v_parent.id;

  v_output_snapshot := pg_catalog.jsonb_build_object(
    'generationKind', 'manual_revision',
    'parentEstimateVersionId', v_parent.id,
    'parsedRequirement', v_parent.parsed_requirement,
    'functionModules', p_functions,
    'projectRoles', p_project_roles,
    'additionalWorkItems', v_additional_work,
    'costEstimate', p_cost_estimate
  );
  v_snapshot_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_output_snapshot::TEXT, 'UTF8'), 'sha256'
  ), 'hex');
  v_revision_no := v_parent.revision_no + 1;

  INSERT INTO public.estimate_versions (
    project_id, revision_no, parent_version_id, requirement_baseline_id,
    requirement_baseline_content_hash, agent_execution_id, generation_kind,
    input_snapshot, system_config_snapshot, parsed_requirement, output_snapshot,
    snapshot_hash, model_id, workflow_version, prompt_versions,
    output_schema_version, cost_rule_version, service_policy_version, created_by
  ) VALUES (
    v_project.id, v_revision_no, v_parent.id, v_parent.requirement_baseline_id,
    v_parent.requirement_baseline_content_hash, NULL, 'manual_revision',
    pg_catalog.jsonb_build_object(
      'parentEstimateVersionId', v_parent.id,
      'requirementBaselineId', v_parent.requirement_baseline_id,
      'requirementBaselineContentHash', v_parent.requirement_baseline_content_hash,
      'manualRevisionType', 'formal_cost_recalculation'
    ),
    v_parent.system_config_snapshot, v_parent.parsed_requirement,
    v_output_snapshot, v_snapshot_hash, v_parent.model_id,
    v_parent.workflow_version, v_parent.prompt_versions,
    v_parent.output_schema_version, p_cost_estimate->>'rule_version',
    p_cost_estimate->>'service_policy_version', p_actor_user_id
  ) RETURNING id INTO v_estimate_version_id;

  v_sequence := 0;
  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_functions) LOOP
    INSERT INTO public.estimate_version_functions (
      estimate_version_id, project_id, sequence_no, module_name, function_name,
      description, difficulty_level, estimated_hours, dependencies, role_estimates,
      is_verified
    ) VALUES (
      v_estimate_version_id, v_project.id, v_sequence,
      v_item->>'module_name', v_item->>'function_name', NULLIF(v_item->>'description', ''),
      v_item->>'difficulty_level', (v_item->>'estimated_hours')::DECIMAL,
      CASE WHEN v_item->'dependencies' IS NULL OR v_item->'dependencies' = 'null'::jsonb
        THEN NULL ELSE ARRAY(SELECT pg_catalog.jsonb_array_elements_text(v_item->'dependencies')) END,
      COALESCE(v_item->'role_estimates', '[]'::jsonb),
      COALESCE((v_item->>'is_verified')::BOOLEAN, FALSE)
    );
    v_sequence := v_sequence + 1;
  END LOOP;

  v_sequence := 0;
  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_project_roles) LOOP
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

  INSERT INTO public.estimate_version_additional_work (
    estimate_version_id, project_id, sequence_no, work_item, days, assigned_roles
  )
  SELECT v_estimate_version_id, v_project.id, work.sequence_no, work.work_item,
         work.days, work.assigned_roles
    FROM public.estimate_version_additional_work work
   WHERE work.estimate_version_id = v_parent.id
   ORDER BY work.sequence_no;

  v_item := p_cost_estimate;
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

  UPDATE public.projects
     SET latest_estimate_version_id = v_estimate_version_id,
         estimate_revision = v_revision_no
   WHERE id = v_project.id;

  RETURN v_revision_no;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_estimate_version(
  p_project_id UUID,
  p_estimate_version_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project public.projects%ROWTYPE;
BEGIN
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION '仅登录用户可以发布估算版本' USING ERRCODE = '42501';
  END IF;

  SELECT p.* INTO v_project
    FROM public.projects p
   WHERE p.id = p_project_id AND p.created_by = auth.uid()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '项目不存在或无权限访问' USING ERRCODE = 'P0002';
  END IF;
  IF v_project.status = 'archived' THEN
    RAISE EXCEPTION '归档项目不能发布估算版本' USING ERRCODE = 'P0001';
  END IF;
  IF v_project.latest_estimate_version_id IS DISTINCT FROM p_estimate_version_id THEN
    RAISE EXCEPTION '只能发布项目当前最新估算版本' USING ERRCODE = '40001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.estimate_versions ev
     WHERE ev.id = p_estimate_version_id AND ev.project_id = p_project_id
       AND ev.requirement_baseline_id = v_project.current_requirement_baseline_id
  ) THEN
    RAISE EXCEPTION '估算版本不存在、项目不匹配或基于旧需求基线' USING ERRCODE = '23503';
  END IF;

  UPDATE public.projects
     SET published_estimate_version_id = p_estimate_version_id
   WHERE id = p_project_id;
  RETURN p_estimate_version_id;
END;
$$;

-- 统一 project -> execution 锁顺序，并只允许后台服务写入执行终态。
DROP FUNCTION IF EXISTS public.finish_presales_execution(UUID, TEXT, TEXT, INTEGER);
CREATE FUNCTION public.finish_presales_execution(
  p_actor_user_id UUID,
  p_execution_id UUID,
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
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以结束售前分析' USING ERRCODE = '42501';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION '缺少执行发起用户' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('failed', 'cancelled', 'timed_out') THEN
    RAISE EXCEPTION '不支持的终态: %', p_status USING ERRCODE = '22023';
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
   FOR UPDATE;
  IF NOT FOUND OR v_execution.status <> 'running' THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = v_project_id AND p.status = 'archived'
  ) THEN
    UPDATE public.agent_executions
       SET status = 'cancelled', error_message = '项目已归档，执行已取消',
           execution_time_ms = GREATEST(COALESCE(p_execution_time_ms, 0), 0),
           completed_at = NOW()
     WHERE id = p_execution_id;
    RETURN;
  END IF;

  v_previous_status := v_execution.input_data->>'previousProjectStatus';
  IF v_previous_status NOT IN ('draft', 'completed') THEN v_previous_status := 'draft'; END IF;

  UPDATE public.agent_executions
     SET status = p_status, error_message = p_error_message,
         execution_time_ms = GREATEST(COALESCE(p_execution_time_ms, 0), 0),
         completed_at = NOW()
   WHERE id = p_execution_id;
  UPDATE public.projects SET status = v_previous_status WHERE id = v_project_id;
END;
$$;

-- 主动巡检超时售前执行，避免仅在下一次 begin 时才恢复 running/analyzing 状态。
-- Trigger.dev 定时任务以 service role 调用；锁定项目并使用 SKIP LOCKED，避免与提交/结束事务互相阻塞。
CREATE FUNCTION public.reconcile_stale_presales_executions(
  p_stale_after_seconds INTEGER DEFAULT 900,
  p_batch_size INTEGER DEFAULT 100
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_candidate RECORD;
  v_previous_status TEXT;
  v_reconciled INTEGER := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '仅后台服务可以巡检售前执行' USING ERRCODE = '42501';
  END IF;
  IF p_stale_after_seconds < 60 OR p_stale_after_seconds > 86400 THEN
    RAISE EXCEPTION '超时阈值必须在 60 到 86400 秒之间' USING ERRCODE = '22023';
  END IF;
  IF p_batch_size < 1 OR p_batch_size > 1000 THEN
    RAISE EXCEPTION '批次大小必须在 1 到 1000 之间' USING ERRCODE = '22023';
  END IF;

  FOR v_candidate IN
    SELECT ae.id, ae.project_id, ae.created_at, ae.input_data
      FROM public.agent_executions ae
     WHERE ae.agent_type = 'presales_estimation'
       AND ae.status = 'running'
       AND ae.created_at < NOW() - pg_catalog.make_interval(secs => p_stale_after_seconds)
     ORDER BY ae.created_at
     LIMIT p_batch_size
  LOOP
    PERFORM 1 FROM public.projects p
     WHERE p.id = v_candidate.project_id
     FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;

    PERFORM 1 FROM public.agent_executions ae
     WHERE ae.id = v_candidate.id
       AND ae.project_id = v_candidate.project_id
       AND ae.status = 'running'
       AND ae.created_at < NOW() - pg_catalog.make_interval(secs => p_stale_after_seconds)
     FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;

    UPDATE public.agent_executions
       SET status = 'timed_out',
           error_message = COALESCE(
             error_message,
             '后台巡检发现执行超过时限未结束，已自动标记超时'
           ),
           execution_time_ms = COALESCE(
             execution_time_ms,
             LEAST(
               FLOOR(EXTRACT(EPOCH FROM (NOW() - v_candidate.created_at)) * 1000),
               2147483647
             )::INTEGER
           ),
           completed_at = COALESCE(completed_at, NOW())
     WHERE id = v_candidate.id
       AND status = 'running';
    IF NOT FOUND THEN CONTINUE; END IF;

    v_previous_status := v_candidate.input_data->>'previousProjectStatus';
    IF v_previous_status NOT IN ('draft', 'completed') THEN
      v_previous_status := 'draft';
    END IF;

    UPDATE public.projects
       SET status = CASE
         WHEN status = 'archived' THEN status
         WHEN status = 'analyzing' THEN v_previous_status
         ELSE status
       END
     WHERE id = v_candidate.project_id;

    v_reconciled := v_reconciled + 1;
  END LOOP;

  RETURN v_reconciled;
END;
$$;

REVOKE ALL ON TABLE public.agent_executions FROM anon, authenticated;
GRANT SELECT ON TABLE public.agent_executions TO authenticated;

REVOKE ALL ON TABLE public.estimate_versions FROM anon, authenticated;
REVOKE ALL ON TABLE public.estimate_version_functions FROM anon, authenticated;
REVOKE ALL ON TABLE public.estimate_version_roles FROM anon, authenticated;
REVOKE ALL ON TABLE public.estimate_version_additional_work FROM anon, authenticated;
REVOKE ALL ON TABLE public.estimate_version_costs FROM anon, authenticated;
GRANT SELECT ON TABLE public.estimate_versions TO authenticated;
GRANT SELECT ON TABLE public.estimate_version_functions TO authenticated;
GRANT SELECT ON TABLE public.estimate_version_roles TO authenticated;
GRANT SELECT ON TABLE public.estimate_version_additional_work TO authenticated;
GRANT SELECT ON TABLE public.estimate_version_costs TO authenticated;

REVOKE ALL ON FUNCTION public.protect_agent_execution_provenance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_immutable_estimate_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_project_estimate_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_estimate_version_lineage() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_formal_project_cost_aggregate(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_formal_project_cost_aggregate(UUID)
  TO authenticated;
REVOKE ALL ON FUNCTION public.commit_manual_cost_recalculation(
  UUID, UUID, BIGINT, JSONB, JSONB, UUID, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_manual_cost_recalculation(
  UUID, UUID, BIGINT, JSONB, JSONB, UUID, JSONB
) TO service_role;
REVOKE ALL ON FUNCTION public.publish_initial_requirement_baseline(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_initial_requirement_baseline(UUID, UUID)
  TO authenticated;
REVOKE ALL ON FUNCTION public.publish_estimate_version(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_estimate_version(UUID, UUID)
  TO authenticated;
REVOKE ALL ON FUNCTION public.begin_presales_execution(
  UUID, UUID, UUID, TEXT, JSONB, JSONB, TEXT, TEXT, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_presales_execution(UUID, UUID, JSONB, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_presales_execution(UUID, UUID, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_stale_presales_executions(INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_presales_execution(
  UUID, UUID, UUID, TEXT, JSONB, JSONB, TEXT, TEXT, JSONB, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_presales_execution(UUID, UUID, JSONB, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_presales_execution(UUID, UUID, TEXT, TEXT, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_presales_executions(INTEGER, INTEGER)
  TO service_role;
