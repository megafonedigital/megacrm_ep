ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS ai_humanize jsonb NOT NULL DEFAULT '{"enabled": false}'::jsonb;