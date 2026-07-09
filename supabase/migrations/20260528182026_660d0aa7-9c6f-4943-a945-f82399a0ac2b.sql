
CREATE OR REPLACE FUNCTION public.claim_broadcast_dispatch_queue(_limit integer)
 RETURNS TABLE(id uuid, broadcast_id uuid, target_id uuid, brand_id uuid, automation_id uuid, contact_id uuid, conversation_id uuid, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT
      q.id              AS queue_id,
      q.broadcast_id    AS bcast_id,
      q.scheduled_send_at,
      q.created_at,
      b.rate_per_minute,
      GREATEST(
        0,
        b.rate_per_minute - COALESCE(
          (SELECT count(*)::int
             FROM public.broadcast_targets t
            WHERE t.broadcast_id = b.id
              AND t.dispatched_at >= now() - interval '1 minute'),
          0
        )
      ) AS budget_remaining
    FROM public.broadcast_dispatch_queue q
    JOIN public.broadcasts b ON b.id = q.broadcast_id
    WHERE q.status = 'pending'
      AND q.next_attempt_at <= now()
      AND q.scheduled_send_at <= now()
      AND b.status = 'running'
  ), ranked AS (
    SELECT
      d.queue_id,
      d.bcast_id,
      d.budget_remaining,
      row_number() OVER (PARTITION BY d.bcast_id ORDER BY d.scheduled_send_at, d.created_at) AS rn
    FROM due d
  ), eligible AS (
    SELECT r.queue_id
      FROM ranked r
     WHERE r.rn <= r.budget_remaining
     LIMIT GREATEST(_limit, 0)
  ), picked AS (
    SELECT q.id AS queue_id
      FROM public.broadcast_dispatch_queue q
     WHERE q.id IN (SELECT e.queue_id FROM eligible e)
     ORDER BY q.scheduled_send_at, q.created_at
     FOR UPDATE OF q SKIP LOCKED
  )
  UPDATE public.broadcast_dispatch_queue q
     SET status = 'processing',
         claimed_at = now(),
         attempts = q.attempts + 1,
         updated_at = now()
    FROM picked p
   WHERE q.id = p.queue_id
   RETURNING q.id, q.broadcast_id, q.target_id, q.brand_id, q.automation_id, q.contact_id, q.conversation_id, q.attempts;
END;
$function$;
