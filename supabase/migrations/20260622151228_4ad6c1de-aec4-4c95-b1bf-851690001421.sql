ALTER TABLE public.ai_agents ADD COLUMN IF NOT EXISTS transcribe_inbound_audio boolean NOT NULL DEFAULT false;
UPDATE public.ai_agents SET transcribe_inbound_audio = true WHERE name ILIKE 'Ellie%';