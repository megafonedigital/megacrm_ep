CREATE OR REPLACE FUNCTION public.claim_broadcast_dispatch_queue(_limit integer)
 RETURNS TABLE(id uuid, broadcast_id uuid, target_id uuid, brand_id uuid, automation_id uuid, contact_id uuid, conversation_id uuid, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT q.id AS queue_id
      FROM public.broadcast_dispatch_queue q
      JOIN public.broadcasts b ON b.id = q.broadcast_id
     WHERE q.status = 'pending'
       AND q.next_attempt_at <= now()
       AND q.scheduled_send_at <= now()
       AND b.status = 'running'
     ORDER BY q.scheduled_send_at, q.created_at
     LIMIT GREATEST(_limit, 0)
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