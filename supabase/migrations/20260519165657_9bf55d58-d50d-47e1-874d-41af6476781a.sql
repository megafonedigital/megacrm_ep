
CREATE OR REPLACE FUNCTION public.claim_integration_events(_account_id uuid, _limit integer)
RETURNS TABLE(id uuid, payload jsonb, attempts integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH picked AS (
    SELECT q.id
      FROM public.integration_event_queue q
     WHERE q.account_id = _account_id
       AND q.status = 'pending'
       AND q.next_attempt_at <= now()
     ORDER BY q.received_at
     LIMIT GREATEST(_limit, 0)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.integration_event_queue q
     SET status = 'processing',
         started_at = now()
   FROM picked
   WHERE q.id = picked.id
   RETURNING q.id, q.payload, q.attempts;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_integration_events(uuid, integer) FROM PUBLIC, anon, authenticated;
