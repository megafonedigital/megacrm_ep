
ALTER TABLE public.integration_events
  ADD COLUMN IF NOT EXISTS platform integration_platform;

UPDATE public.integration_events ev
   SET platform = ia.platform
  FROM public.integration_accounts ia
 WHERE ia.id = ev.account_id
   AND ev.platform IS NULL;

CREATE OR REPLACE FUNCTION public.set_integration_event_platform()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.platform IS NULL THEN
    SELECT ia.platform INTO NEW.platform
      FROM public.integration_accounts ia
     WHERE ia.id = NEW.account_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_integration_event_platform ON public.integration_events;
CREATE TRIGGER trg_set_integration_event_platform
  BEFORE INSERT ON public.integration_events
  FOR EACH ROW EXECUTE FUNCTION public.set_integration_event_platform();

ALTER TABLE public.integration_events
  ALTER COLUMN platform SET NOT NULL;
