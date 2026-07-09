
DROP INDEX IF EXISTS public.uniq_integration_events_external;
CREATE UNIQUE INDEX uniq_integration_events_external
  ON public.integration_events (account_id, brand_id, event_type, external_id)
  WHERE external_id IS NOT NULL;
