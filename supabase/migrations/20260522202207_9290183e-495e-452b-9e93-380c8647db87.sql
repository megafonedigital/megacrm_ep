
-- Enums
DO $$ BEGIN
  CREATE TYPE public.ai_test_scenario_source AS ENUM ('manual', 'faq');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ai_test_scenario_status AS ENUM ('pending', 'pass', 'fail', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.ai_agent_test_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  source public.ai_test_scenario_source NOT NULL DEFAULT 'manual',
  faq_source_kind text,
  faq_source_kb_id uuid,
  faq_source_index integer,
  turns jsonb NOT NULL DEFAULT '[]'::jsonb,
  expect_must_contain text[] NOT NULL DEFAULT ARRAY[]::text[],
  expect_must_not_contain text[] NOT NULL DEFAULT ARRAY[]::text[],
  expect_need_human boolean NOT NULL DEFAULT false,
  expect_need_human_reason text,
  judge_criteria text,
  last_status public.ai_test_scenario_status NOT NULL DEFAULT 'pending',
  last_run_at timestamptz,
  last_response text,
  last_failures jsonb,
  last_judge_verdict jsonb,
  last_tokens_in integer,
  last_tokens_out integer,
  last_duration_ms integer,
  last_model text,
  last_tool_call jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_agent_test_scenarios_agent_idx ON public.ai_agent_test_scenarios(agent_id);
CREATE UNIQUE INDEX IF NOT EXISTS ai_agent_test_scenarios_faq_uq
  ON public.ai_agent_test_scenarios(agent_id, faq_source_kind, faq_source_kb_id, faq_source_index)
  WHERE source = 'faq';

ALTER TABLE public.ai_agent_test_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_agent_test_scenarios_admin_all
  ON public.ai_agent_test_scenarios FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY ai_agent_test_scenarios_select_member
  ON public.ai_agent_test_scenarios FOR SELECT TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));

CREATE POLICY ai_agent_test_scenarios_write_supervisor
  ON public.ai_agent_test_scenarios FOR ALL TO authenticated
  USING (
    public.has_brand_access(auth.uid(), brand_id)
    AND (public.has_role(auth.uid(), 'supervisor'::app_role) OR public.has_role(auth.uid(), 'developer'::app_role))
  )
  WITH CHECK (
    public.has_brand_access(auth.uid(), brand_id)
    AND (public.has_role(auth.uid(), 'supervisor'::app_role) OR public.has_role(auth.uid(), 'developer'::app_role))
  );

CREATE TRIGGER ai_agent_test_scenarios_set_updated_at
  BEFORE UPDATE ON public.ai_agent_test_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
