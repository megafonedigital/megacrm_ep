
CREATE TABLE public.ai_agent_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL,
  version_number integer NOT NULL,
  label text,
  notes text,
  source text NOT NULL DEFAULT 'manual', -- 'manual' | 'auto_prompt_change' | 'restore'
  system_prompt text NOT NULL DEFAULT '',
  model text NOT NULL,
  temperature numeric NOT NULL,
  max_output_tokens integer NOT NULL,
  response_delay_ms integer NOT NULL,
  context_window_messages integer NOT NULL,
  escalation_target_suporte uuid,
  escalation_target_vendas uuid,
  inputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  rate_limit_per_conversation integer NOT NULL DEFAULT 30,
  rate_limit_window_minutes integer NOT NULL DEFAULT 60,
  rate_limit_per_agent_hour integer,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version_number)
);

CREATE INDEX idx_ai_agent_versions_agent_created ON public.ai_agent_versions (agent_id, created_at DESC);
CREATE INDEX idx_ai_agent_versions_brand ON public.ai_agent_versions (brand_id);

ALTER TABLE public.ai_agent_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_agent_versions_admin_all" ON public.ai_agent_versions
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "ai_agent_versions_select_member" ON public.ai_agent_versions
  FOR SELECT TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));

CREATE POLICY "ai_agent_versions_write_supervisor" ON public.ai_agent_versions
  FOR ALL TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id) AND (public.has_role(auth.uid(), 'supervisor'::app_role) OR public.has_role(auth.uid(), 'developer'::app_role)))
  WITH CHECK (public.has_brand_access(auth.uid(), brand_id) AND (public.has_role(auth.uid(), 'supervisor'::app_role) OR public.has_role(auth.uid(), 'developer'::app_role)));

ALTER TABLE public.ai_agents ADD COLUMN current_version_id uuid;
