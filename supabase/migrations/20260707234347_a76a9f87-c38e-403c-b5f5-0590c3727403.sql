DROP INDEX IF EXISTS public.uq_ieq_account_event_external;

CREATE UNIQUE INDEX uq_ieq_account_event_external_pending
  ON public.integration_event_queue (account_id, event_type, external_id)
  WHERE external_id IS NOT NULL AND status = 'pending';