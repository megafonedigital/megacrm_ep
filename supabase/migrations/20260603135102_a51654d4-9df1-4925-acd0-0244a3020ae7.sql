CREATE OR REPLACE FUNCTION public.reap_stuck_integration_events(_older_than interval DEFAULT interval '5 minutes')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  reaped_count integer;
BEGIN
  UPDATE public.integration_event_queue
     SET status = 'pending',
         started_at = NULL,
         next_attempt_at = now(),
         last_error = COALESCE(last_error, '') || ' [reaped: stuck in processing]'
   WHERE status = 'processing'
     AND started_at IS NOT NULL
     AND started_at < now() - _older_than;
  GET DIAGNOSTICS reaped_count = ROW_COUNT;
  RETURN reaped_count;
END;
$$;