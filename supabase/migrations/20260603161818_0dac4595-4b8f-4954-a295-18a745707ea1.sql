DROP FUNCTION IF EXISTS public.reap_stuck_integration_events(interval);

CREATE FUNCTION public.reap_stuck_integration_events(_older_than interval)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  WITH r AS (
    UPDATE integration_event_queue
    SET status='pending', started_at=NULL, next_attempt_at=now(),
        last_error='[reaped: stuck in processing]'
    WHERE status='processing' AND started_at < now() - _older_than
    RETURNING id
  ) SELECT COUNT(*)::int FROM r;
$$;

CREATE OR REPLACE FUNCTION public.mark_integration_events_done(_ids uuid[])
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  WITH r AS (
    UPDATE integration_event_queue
    SET status='done', finished_at=now()
    WHERE id = ANY(_ids) AND status='processing'
    RETURNING id
  ) SELECT COUNT(*)::int FROM r;
$$;

GRANT EXECUTE ON FUNCTION public.reap_stuck_integration_events(interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_integration_events_done(uuid[]) TO service_role;