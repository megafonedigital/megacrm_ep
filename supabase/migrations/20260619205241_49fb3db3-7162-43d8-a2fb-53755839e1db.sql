ALTER TABLE public.ai_agents
  ADD COLUMN IF NOT EXISTS help_me_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS help_me_slow_speed numeric NOT NULL DEFAULT 0.75;