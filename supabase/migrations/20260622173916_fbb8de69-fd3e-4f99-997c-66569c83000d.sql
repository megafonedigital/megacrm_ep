ALTER TABLE public.ai_agents ALTER COLUMN transcribe_inbound_audio SET DEFAULT true;
UPDATE public.ai_agents SET transcribe_inbound_audio = true WHERE transcribe_inbound_audio IS DISTINCT FROM true;