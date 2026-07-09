
CREATE TYPE public.automation_status AS ENUM ('draft', 'active', 'inactive');
CREATE TYPE public.automation_run_status AS ENUM ('waiting', 'running', 'completed', 'failed', 'cancelled');

CREATE TABLE public.automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_template_id UUID REFERENCES public.whatsapp_templates(id) ON DELETE SET NULL,
  status public.automation_status NOT NULL DEFAULT 'draft',
  graph JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_automations_brand ON public.automations(brand_id);
CREATE INDEX idx_automations_trigger_tpl ON public.automations(trigger_template_id) WHERE status = 'active';

CREATE TABLE public.automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  current_node_id TEXT,
  status public.automation_run_status NOT NULL DEFAULT 'waiting',
  variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX idx_automation_runs_conv ON public.automation_runs(conversation_id) WHERE status IN ('waiting','running');
CREATE INDEX idx_automation_runs_automation ON public.automation_runs(automation_id);

CREATE TABLE public.automation_run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.automation_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  payload JSONB,
  error TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_run_steps_run ON public.automation_run_steps(run_id);

CREATE OR REPLACE FUNCTION public.tg_automation_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_automations_updated BEFORE UPDATE ON public.automations
  FOR EACH ROW EXECUTE FUNCTION public.tg_automation_updated_at();
CREATE TRIGGER trg_automation_runs_updated BEFORE UPDATE ON public.automation_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_automation_updated_at();

ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_run_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View automations of accessible brands"
ON public.automations FOR SELECT TO authenticated
USING (public.has_brand_access(brand_id, auth.uid()));

CREATE POLICY "Admin/supervisor manage automations"
ON public.automations FOR ALL TO authenticated
USING (
  public.has_brand_access(brand_id, auth.uid())
  AND public.is_admin(auth.uid())
)
WITH CHECK (
  public.has_brand_access(brand_id, auth.uid())
  AND public.is_admin(auth.uid())
);

CREATE POLICY "View runs of accessible brands"
ON public.automation_runs FOR SELECT TO authenticated
USING (public.has_brand_access(brand_id, auth.uid()));

CREATE POLICY "View run steps of accessible brands"
ON public.automation_run_steps FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.automation_runs r
    WHERE r.id = run_id AND public.has_brand_access(r.brand_id, auth.uid())
  )
);
