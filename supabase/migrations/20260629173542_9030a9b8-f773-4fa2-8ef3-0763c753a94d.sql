CREATE TABLE public.ai_agent_delivery_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES public.brand_channels(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  job_kind text NOT NULL CHECK (job_kind IN ('text', 'interactive_help_me', 'audio')),
  sequence integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  content text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  sent_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_agent_delivery_jobs TO authenticated;
GRANT ALL ON public.ai_agent_delivery_jobs TO service_role;

ALTER TABLE public.ai_agent_delivery_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_agent_delivery_jobs_admin
  ON public.ai_agent_delivery_jobs
  FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE INDEX idx_ai_agent_delivery_jobs_due
  ON public.ai_agent_delivery_jobs (status, run_after, sequence, created_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX idx_ai_agent_delivery_jobs_conversation
  ON public.ai_agent_delivery_jobs (conversation_id, created_at);

CREATE UNIQUE INDEX idx_ai_agent_delivery_jobs_message_once
  ON public.ai_agent_delivery_jobs (message_id)
  WHERE message_id IS NOT NULL;

CREATE TRIGGER ai_agent_delivery_jobs_set_updated_at
BEFORE UPDATE ON public.ai_agent_delivery_jobs
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();