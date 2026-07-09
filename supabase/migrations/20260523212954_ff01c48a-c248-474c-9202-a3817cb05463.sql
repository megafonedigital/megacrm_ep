
ALTER TABLE public.ai_agents
  ADD COLUMN IF NOT EXISTS escalation_alert_threshold_pct numeric,
  ADD COLUMN IF NOT EXISTS escalation_alert_window_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS escalation_alert_min_runs integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS tracking_tag text;

CREATE UNIQUE INDEX IF NOT EXISTS ai_agents_tracking_tag_brand_unique
  ON public.ai_agents (brand_id, lower(tracking_tag))
  WHERE tracking_tag IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ai_agent_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  kind text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_agent_alerts_active_unique
  ON public.ai_agent_alerts (agent_id, kind)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS ai_agent_alerts_agent_created_idx
  ON public.ai_agent_alerts (agent_id, created_at DESC);

ALTER TABLE public.ai_agent_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_agent_alerts_admin_all ON public.ai_agent_alerts
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY ai_agent_alerts_select_member ON public.ai_agent_alerts
  FOR SELECT TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));

CREATE POLICY ai_agent_alerts_insert_member ON public.ai_agent_alerts
  FOR INSERT TO authenticated
  WITH CHECK (public.has_brand_access(auth.uid(), brand_id));

CREATE POLICY ai_agent_alerts_update_member ON public.ai_agent_alerts
  FOR UPDATE TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id))
  WITH CHECK (public.has_brand_access(auth.uid(), brand_id));
