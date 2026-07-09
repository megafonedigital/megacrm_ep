ALTER TABLE public.automations REPLICA IDENTITY FULL;
ALTER TABLE public.automation_folders REPLICA IDENTITY FULL;
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.automations;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.automation_folders;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;