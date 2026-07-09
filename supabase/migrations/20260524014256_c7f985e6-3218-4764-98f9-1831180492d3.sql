ALTER PUBLICATION supabase_realtime ADD TABLE public.pipeline_contacts;
ALTER TABLE public.pipeline_contacts REPLICA IDENTITY FULL;