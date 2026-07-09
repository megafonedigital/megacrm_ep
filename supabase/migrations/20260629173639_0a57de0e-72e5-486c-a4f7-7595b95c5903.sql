ALTER TABLE public.ai_agent_delivery_jobs
  ADD COLUMN IF NOT EXISTS group_id uuid NOT NULL DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS idx_ai_agent_delivery_jobs_group_sequence
  ON public.ai_agent_delivery_jobs (group_id, sequence);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_agent_delivery_jobs_group_sequence_once
  ON public.ai_agent_delivery_jobs (group_id, sequence);