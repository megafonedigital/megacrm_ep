ALTER TABLE public.ai_agents
  ADD COLUMN IF NOT EXISTS rate_limit_per_conversation integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS rate_limit_window_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS rate_limit_per_agent_hour integer NULL;