-- 1) Aumentar burst cap do token bucket de rate/6 (~10s) para rate/3 (~20s).
-- Com cron a 5s, burst de rate/3 absorve até 4 drains atrasados sem perder tokens.
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
             -- Burst cap = rate/3 (~20s do rate). Cron roda a cada 5s,
             -- então o bucket absorve até 4 drains perdidos antes de saturar.
             GREATEST(b.rate_per_minute, 1)::numeric / 3.0,
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
    RETURNING 1
  ),
  updated AS (
    UPDATE public.broadcast_dispatch_queue q
       SET status = 'processing',
           claimed_at = now(),
           updated_at = now()
      FROM picked p
     WHERE q.id = p.queue_id
    RETURNING q.id, q.broadcast_id, q.target_id, q.brand_id, q.automation_id,
              q.contact_id, q.conversation_id, q.attempts
  )
  SELECT u.id, u.broadcast_id, u.target_id, u.brand_id, u.automation_id,
         u.contact_id, u.conversation_id, u.attempts
    FROM updated u;
END;
$function$;

-- 2) Índice parcial para o predicado do claim. O índice atual não cobre
-- scheduled_send_at, causando filter extra em filas grandes.
CREATE INDEX IF NOT EXISTS idx_broadcast_dispatch_queue_pending_sched
  ON public.broadcast_dispatch_queue (broadcast_id, scheduled_send_at, created_at)
  WHERE status = 'pending';

-- 3) Acelera cron do broadcast-loop de 10s para 5s.
-- Resultado: 12 drains/min × ~267 tokens (refill em 5s) = 3200/min sustentado.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'broadcast-loop-10s'),
  schedule := '5 seconds'
)
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'broadcast-loop-10s');