
CREATE TABLE public.ai_agent_ab_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL,
  name text NOT NULL,
  description text NULL,
  version_a_id uuid NOT NULL REFERENCES public.ai_agent_versions(id) ON DELETE RESTRICT,
  version_b_id uuid NOT NULL REFERENCES public.ai_agent_versions(id) ON DELETE RESTRICT,
  traffic_b_percent integer NOT NULL DEFAULT 50 CHECK (traffic_b_percent BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','stopped','completed')),
  starts_at timestamptz NULL,
  ends_at timestamptz NULL,
  winner text NULL CHECK (winner IN ('a','b','tie')),
  notes text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (version_a_id <> version_b_id)
);

CREATE INDEX idx_ai_agent_ab_tests_agent_status ON public.ai_agent_ab_tests(agent_id, status);
CREATE UNIQUE INDEX uniq_ai_agent_ab_tests_one_running
  ON public.ai_agent_ab_tests(agent_id) WHERE status = 'running';

ALTER TABLE public.ai_agent_ab_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ab_tests_select" ON public.ai_agent_ab_tests
  FOR SELECT TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));
CREATE POLICY "ab_tests_insert" ON public.ai_agent_ab_tests
  FOR INSERT TO authenticated
  WITH CHECK (public.has_brand_access(auth.uid(), brand_id));
CREATE POLICY "ab_tests_update" ON public.ai_agent_ab_tests
  FOR UPDATE TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id))
  WITH CHECK (public.has_brand_access(auth.uid(), brand_id));
CREATE POLICY "ab_tests_delete" ON public.ai_agent_ab_tests
  FOR DELETE TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));

CREATE TRIGGER ai_agent_ab_tests_set_updated_at
BEFORE UPDATE ON public.ai_agent_ab_tests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ai_agent_runs
  ADD COLUMN version_id uuid NULL REFERENCES public.ai_agent_versions(id) ON DELETE SET NULL,
  ADD COLUMN ab_test_id uuid NULL REFERENCES public.ai_agent_ab_tests(id) ON DELETE SET NULL,
  ADD COLUMN ab_variant text NULL CHECK (ab_variant IN ('a','b'));

CREATE INDEX idx_ai_agent_runs_ab ON public.ai_agent_runs(ab_test_id, ab_variant, created_at);
CREATE INDEX idx_ai_agent_runs_version ON public.ai_agent_runs(version_id);
