ALTER TABLE public.ai_agents
  ADD COLUMN IF NOT EXISTS inputs jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.ai_agent_runs
  ADD COLUMN IF NOT EXISTS input_variables jsonb;