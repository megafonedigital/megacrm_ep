BEGIN;
DROP INDEX IF EXISTS public.uq_ieq_account_external;
CREATE UNIQUE INDEX uq_ieq_account_event_external
  ON public.integration_event_queue (account_id, event_type, external_id)
  WHERE external_id IS NOT NULL;
COMMIT;