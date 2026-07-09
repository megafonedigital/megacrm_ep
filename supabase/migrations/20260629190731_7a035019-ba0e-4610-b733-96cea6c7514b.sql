-- Fix 1: troca cron broadcast-loop de 5s para 2s
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE command LIKE '%/api/public/cron/broadcast-loop%' LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'broadcast-loop-2s',
  '2 seconds',
  $$
  SELECT net.http_post(
    url:='https://project--6e4da8e7-db19-41db-a13a-c49a88fe3218.lovable.app/api/public/cron/broadcast-loop',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15bm12eWN3aGZleHdoeXp4bnpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDU3MjksImV4cCI6MjA5MzU4MTcyOX0.uBS4WdEcbHB2tO6VqW-EfJI9zNAUMT3-5KWOpTQ6cLk"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);

-- Fix 2: burst_cap de rate/12 para rate/30 (piso 5)
CREATE OR REPLACE FUNCTION public.claim_broadcast_dispatch_queue(_limit integer)
  RETURNS TABLE(id uuid, broadcast_id uuid, target_id uuid, brand_id uuid, automation_id uuid, contact_id uuid, conversation_id uuid, attempts integer)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.broadcast_rate_state (broadcast_id, tokens, last_refill_at)
  SELECT b.id, 0, now()
    FROM public.broadcasts b
   WHERE b.status = 'running'
  ON CONFLICT ON CONSTRAINT broadcast_rate_state_pkey DO NOTHING;

  RETURN QUERY
  WITH
  refilled AS (
    UPDATE public.broadcast_rate_state s
       SET tokens = LEAST(
             -- Burst cap = rate/30 (1 ciclo de cron de 2s). Piso 5 protege
             -- rates muito baixos. 30 drains/min * rate/30 = rate exato.
             GREATEST(5, ROUND(GREATEST(b.rate_per_minute, 1)::numeric / 30.0)),
             s.tokens + EXTRACT(EPOCH FROM (now() - s.last_refill_at))
                        * (GREATEST(b.rate_per_minute, 1)::numeric / 60.0)
           ),
           last_refill_at = now(),
           updated_at = now()
      FROM public.broadcasts b
     WHERE b.id = s.broadcast_id
       AND b.status = 'running'
    RETURNING s.broadcast_id, FLOOR(s.tokens)::int AS budget_remaining
  ),
  eligible AS (
    SELECT q.id AS queue_id,
           q.broadcast_id,
           row_number() OVER (PARTITION BY q.broadcast_id ORDER BY q.scheduled_send_at, q.created_at) AS rn
      FROM public.broadcast_dispatch_queue q
      JOIN refilled r ON r.broadcast_id = q.broadcast_id
     WHERE q.status = 'pending'
       AND q.next_attempt_at <= now()
       AND q.scheduled_send_at <= now()
       AND r.budget_remaining > 0
  ),
  capped AS (
    SELECT e.queue_id, e.broadcast_id
      FROM eligible e
      JOIN refilled r ON r.broadcast_id = e.broadcast_id
     WHERE e.rn <= r.budget_remaining
     ORDER BY e.rn, e.queue_id
     LIMIT GREATEST(_limit, 0)
  ),
  picked AS (
    SELECT q.id AS queue_id, q.broadcast_id
      FROM public.broadcast_dispatch_queue q
      JOIN capped c ON c.queue_id = q.id
     WHERE q.status = 'pending'
     FOR UPDATE OF q SKIP LOCKED
  ),
  consumed AS (
    UPDATE public.broadcast_rate_state s
       SET tokens = GREATEST(0, s.tokens - cnt.n),
           updated_at = now()
      FROM (
        SELECT p.broadcast_id, COUNT(*)::numeric AS n
          FROM picked p
         GROUP BY p.broadcast_id
      ) cnt
     WHERE s.broadcast_id = cnt.broadcast_id
    RETURNING s.broadcast_id
  ),
  updated AS (
    UPDATE public.broadcast_dispatch_queue q
       SET status = 'processing',
           locked_at = now(),
           attempts = q.attempts + 1,
           updated_at = now()
      FROM picked p
     WHERE q.id = p.queue_id
    RETURNING q.id, q.broadcast_id, q.target_id, q.brand_id, q.automation_id,
              q.contact_id, q.conversation_id, q.attempts
  )
  SELECT u.id, u.broadcast_id, u.target_id, u.brand_id, u.automation_id,
         u.contact_id, u.conversation_id, u.attempts
    FROM updated u
    WHERE (SELECT COUNT(*) FROM consumed) >= 0;
END;
$function$;