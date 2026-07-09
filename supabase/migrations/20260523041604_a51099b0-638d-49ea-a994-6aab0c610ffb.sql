CREATE TYPE public.ai_agent_run_trigger AS ENUM ('automation', 'manual_test', 'scenario', 'assign_block', 'message');
CREATE TYPE public.ai_agent_run_status AS ENUM ('success', 'error', 'escalated', 'rate_limited');

CREATE TABLE public.ai_agent_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  conversation_id uuid,
  contact_id uuid,
  triggered_by public.ai_agent_run_trigger NOT NULL DEFAULT 'message',
  status public.ai_agent_run_status NOT NULL,
  model text,
  temperature numeric,
  max_output_tokens integer,
  input_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_text text,
  tool_call jsonb,
  tokens_in integer,
  tokens_out integer,
  latency_ms integer,
  error_code text,
  error_message text,
  escalation_track text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_agent_runs_brand_created ON public.ai_agent_runs (brand_id, created_at DESC);
CREATE INDEX idx_ai_agent_runs_agent_created ON public.ai_agent_runs (agent_id, created_at DESC);
CREATE INDEX idx_ai_agent_runs_conversation ON public.ai_agent_runs (conversation_id, created_at DESC);

ALTER TABLE public.ai_agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_agent_runs_admin_all"
ON public.ai_agent_runs
FOR ALL
TO authenticated
USING (is_admin(auth.uid()))
WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "ai_agent_runs_select_member"
ON public.ai_agent_runs
FOR SELECT
TO authenticated
USING (has_brand_access(auth.uid(), brand_id));