
-- 1) Burst cap maior (rate/6 ≈ 10s do rate) para casar com o intervalo do cron
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
             -- Burst cap = rate/6 (~10s do rate) para cobrir o intervalo entre runs do cron.
             GREATEST(b.rate_per_minute, 1)::numeric / 6.0,
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

-- 2) Tabela de snapshots de saúde por broadcast
CREATE TABLE IF NOT EXISTS public.broadcast_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT now(),
  configured_rate integer NOT NULL,
  actual_rate_1m integer NOT NULL DEFAULT 0,
  dispatched_total integer NOT NULL DEFAULT 0,
  pending_total integer NOT NULL DEFAULT 0,
  processing_total integer NOT NULL DEFAULT 0,
  failed_total integer NOT NULL DEFAULT 0,
  tokens_available numeric NOT NULL DEFAULT 0,
  lag_ratio numeric NOT NULL DEFAULT 1,
  under_target boolean NOT NULL DEFAULT false,
  notes text
);

CREATE INDEX IF NOT EXISTS broadcast_health_snapshots_broadcast_time_idx
  ON public.broadcast_health_snapshots (broadcast_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS broadcast_health_snapshots_captured_idx
  ON public.broadcast_health_snapshots (captured_at DESC);

GRANT SELECT ON public.broadcast_health_snapshots TO authenticated;
GRANT ALL ON public.broadcast_health_snapshots TO service_role;

ALTER TABLE public.broadcast_health_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read broadcast health snapshots"
  ON public.broadcast_health_snapshots
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) RPC para coletar snapshots de todos os broadcasts running, em uma chamada
CREATE OR REPLACE FUNCTION public.snapshot_running_broadcast_health()
RETURNS TABLE(
  broadcast_id uuid,
  configured_rate integer,
  actual_rate_1m integer,
  dispatched_total integer,
  pending_total integer,
  processing_total integer,
  failed_total integer,
  tokens_available numeric,
  lag_ratio numeric,
  under_target boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row record;
BEGIN
  FOR _row IN
    SELECT b.id, b.rate_per_minute
      FROM public.broadcasts b
     WHERE b.status = 'running'
  LOOP
    INSERT INTO public.broadcast_health_snapshots (
      broadcast_id, configured_rate, actual_rate_1m,
      dispatched_total, pending_total, processing_total, failed_total,
      tokens_available, lag_ratio, under_target
    )
    SELECT
      _row.id,
      _row.rate_per_minute,
      COALESCE((
        SELECT COUNT(*)::int FROM public.broadcast_targets t
         WHERE t.broadcast_id = _row.id
           AND t.dispatched_at >= now() - interval '1 minute'
      ), 0) AS actual_rate_1m,
      COALESCE((SELECT COUNT(*)::int FROM public.broadcast_targets t WHERE t.broadcast_id = _row.id AND t.status='dispatched'), 0),
      COALESCE((SELECT COUNT(*)::int FROM public.broadcast_targets t WHERE t.broadcast_id = _row.id AND t.status='pending'), 0),
      COALESCE((SELECT COUNT(*)::int FROM public.broadcast_targets t WHERE t.broadcast_id = _row.id AND t.status='processing'), 0),
      COALESCE((SELECT COUNT(*)::int FROM public.broadcast_targets t WHERE t.broadcast_id = _row.id AND t.status='failed'), 0),
      COALESCE((SELECT s.tokens FROM public.broadcast_rate_state s WHERE s.broadcast_id = _row.id), 0),
      0, false
    RETURNING
      broadcast_health_snapshots.broadcast_id,
      broadcast_health_snapshots.configured_rate,
      broadcast_health_snapshots.actual_rate_1m,
      broadcast_health_snapshots.dispatched_total,
      broadcast_health_snapshots.pending_total,
      broadcast_health_snapshots.processing_total,
      broadcast_health_snapshots.failed_total,
      broadcast_health_snapshots.tokens_available,
      broadcast_health_snapshots.lag_ratio,
      broadcast_health_snapshots.under_target
    INTO broadcast_id, configured_rate, actual_rate_1m,
         dispatched_total, pending_total, processing_total, failed_total,
         tokens_available, lag_ratio, under_target;

    -- recomputa lag_ratio / under_target já no row inserido
    UPDATE public.broadcast_health_snapshots s
       SET lag_ratio = CASE WHEN configured_rate > 0
                            THEN ROUND( (actual_rate_1m::numeric / configured_rate)::numeric, 3)
                            ELSE 1 END,
           under_target = (configured_rate > 0
                           AND actual_rate_1m::numeric < configured_rate::numeric * 0.7
                           AND pending_total + processing_total > configured_rate)
     WHERE s.broadcast_id = _row.id
       AND s.captured_at = (SELECT MAX(captured_at) FROM public.broadcast_health_snapshots WHERE broadcast_id = _row.id);

    lag_ratio := CASE WHEN configured_rate > 0
                      THEN ROUND( (actual_rate_1m::numeric / configured_rate)::numeric, 3)
                      ELSE 1 END;
    under_target := (configured_rate > 0
                     AND actual_rate_1m::numeric < configured_rate::numeric * 0.7
                     AND pending_total + processing_total > configured_rate);
    RETURN NEXT;
  END LOOP;

  -- limpeza: mantém ~2h de histórico
  DELETE FROM public.broadcast_health_snapshots WHERE captured_at < now() - interval '2 hours';
END;
$$;
