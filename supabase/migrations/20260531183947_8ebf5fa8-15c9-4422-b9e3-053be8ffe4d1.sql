
-- 1) enqueue_broadcast_dispatches: ancora o relógio no started_at do broadcast
CREATE OR REPLACE FUNCTION public.enqueue_broadcast_dispatches(_broadcast_id uuid, _limit integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  v_rate integer;
  v_started_at timestamptz;
  v_base timestamptz;
  v_max_sched timestamptz;
  v_interval_ms numeric;
  v_max_carry_ahead interval := interval '2 minutes';
  v_effective_limit integer;
BEGIN
  SELECT GREATEST(1, b.rate_per_minute), b.started_at
    INTO v_rate, v_started_at
    FROM public.broadcasts b
   WHERE b.id = _broadcast_id AND b.status = 'running';
  IF v_rate IS NULL THEN
    RETURN 0;
  END IF;

  v_interval_ms := 60000.0 / v_rate;

  v_effective_limit := CASE
    WHEN _limit IS NULL OR _limit <= 0 THEN 500
    ELSE _limit
  END;

  SELECT MAX(q.scheduled_send_at) INTO v_max_sched
    FROM public.broadcast_dispatch_queue q
   WHERE q.broadcast_id = _broadcast_id
     AND q.status IN ('pending', 'processing')
     AND q.scheduled_send_at > now()
     AND q.scheduled_send_at <= now() + v_max_carry_ahead;

  IF v_max_sched IS NULL THEN
    -- Anchor no started_at do broadcast (não em now()) para eliminar o
    -- gap entre o "início" e o primeiro tick do cron. Capa em -5s para
    -- nunca produzir uma rajada grande de itens vencidos quando o
    -- started_at for muito antigo (broadcasts retomados, stragglers).
    v_base := GREATEST(
      COALESCE(v_started_at, now()),
      now() - interval '5 seconds'
    );
    v_base := LEAST(v_base, now() + v_max_carry_ahead);
  ELSE
    v_base := GREATEST(
      now() - interval '5 seconds',
      LEAST(
        v_max_sched + make_interval(secs => v_interval_ms / 1000.0),
        now() + v_max_carry_ahead
      )
    );
  END IF;

  WITH locked AS (
    SELECT t.id, t.created_at
      FROM public.broadcast_targets t
      JOIN public.broadcasts b ON b.id = t.broadcast_id
     WHERE t.broadcast_id = _broadcast_id
       AND b.status = 'running'
       AND t.status = 'pending'
       AND t.run_id IS NULL
     ORDER BY t.created_at
     LIMIT v_effective_limit
     FOR UPDATE OF t SKIP LOCKED
  ), picked AS (
    SELECT l.id,
           t.contact_id,
           b.id AS broadcast_id,
           b.brand_id,
           b.automation_id,
           row_number() OVER (ORDER BY l.created_at) AS rn
      FROM locked l
      JOIN public.broadcast_targets t ON t.id = l.id
      JOIN public.broadcasts b ON b.id = t.broadcast_id
  ), updated_targets AS (
    UPDATE public.broadcast_targets bt
       SET status = 'processing',
           claimed_at = now(),
           error = NULL
      FROM picked p
     WHERE bt.id = p.id
     RETURNING bt.id, bt.contact_id, p.broadcast_id, p.brand_id, p.automation_id, p.rn
  ), inserted AS (
    INSERT INTO public.broadcast_dispatch_queue (
      broadcast_id, target_id, brand_id, automation_id, contact_id, status,
      next_attempt_at, scheduled_send_at, updated_at
    )
    SELECT
      ut.broadcast_id, ut.id, ut.brand_id, ut.automation_id, ut.contact_id, 'pending',
      v_base + make_interval(secs => ((ut.rn - 1) * v_interval_ms) / 1000.0),
      v_base + make_interval(secs => ((ut.rn - 1) * v_interval_ms) / 1000.0)
        + make_interval(secs => (random() * 0.2)),
      now()
      FROM updated_targets ut
    ON CONFLICT (target_id) DO UPDATE
      SET status = CASE
            WHEN public.broadcast_dispatch_queue.status IN ('failed', 'skipped', 'dispatched')
              THEN public.broadcast_dispatch_queue.status
            ELSE 'pending'
          END,
          next_attempt_at = CASE
            WHEN public.broadcast_dispatch_queue.status IN ('dispatched', 'failed', 'skipped')
              THEN public.broadcast_dispatch_queue.next_attempt_at
            ELSE EXCLUDED.next_attempt_at
          END,
          scheduled_send_at = CASE
            WHEN public.broadcast_dispatch_queue.status IN ('dispatched', 'failed', 'skipped')
              THEN public.broadcast_dispatch_queue.scheduled_send_at
            ELSE EXCLUDED.scheduled_send_at
          END,
          claimed_at = CASE
            WHEN public.broadcast_dispatch_queue.status IN ('dispatched', 'failed', 'skipped')
              THEN public.broadcast_dispatch_queue.claimed_at
            ELSE NULL
          END,
          updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM inserted;

  RETURN COALESCE(v_count, 0);
END;
$function$;

-- 2) get_broadcast_speed_series: agora retorna is_partial e conta falhas
DROP FUNCTION IF EXISTS public.get_broadcast_speed_series(uuid, integer);

CREATE OR REPLACE FUNCTION public.get_broadcast_speed_series(_broadcast_id uuid, _minutes integer DEFAULT 60)
 RETURNS TABLE(minute timestamp with time zone, dispatched integer, failed integer, is_partial boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH params AS (
    SELECT
      GREATEST(LEAST(_minutes, 720), 5) AS mins,
      date_trunc('minute', now()) AS now_min,
      now() AS now_ts
  ), b AS (
    SELECT started_at, finished_at
      FROM public.broadcasts
     WHERE id = _broadcast_id
  ), range_bounds AS (
    SELECT
      COALESCE(
        date_trunc('minute', b.started_at),
        params.now_min - make_interval(mins => params.mins)
      ) AS started_min,
      COALESCE(date_trunc('minute', b.finished_at), params.now_min) AS end_min,
      params.now_min - make_interval(mins => params.mins) AS window_start,
      params.now_min AS window_end,
      b.started_at AS started_at,
      b.finished_at AS finished_at,
      params.now_ts AS now_ts
    FROM params, b
  ), bounds AS (
    SELECT
      GREATEST(started_min, window_start) AS lo,
      LEAST(end_min, window_end) AS hi,
      started_at,
      finished_at,
      now_ts
    FROM range_bounds
  ), minutes AS (
    SELECT generate_series(lo, hi, interval '1 minute') AS minute,
           bounds.started_at AS started_at,
           bounds.finished_at AS finished_at,
           bounds.now_ts AS now_ts
      FROM bounds
     WHERE hi >= lo
  ), agg AS (
    SELECT
      date_trunc('minute', dispatched_at) AS minute,
      count(*) FILTER (WHERE status = 'dispatched')::int AS dispatched,
      count(*) FILTER (WHERE status = 'failed')::int AS failed
    FROM public.broadcast_targets
    WHERE broadcast_id = _broadcast_id
      AND dispatched_at IS NOT NULL
      AND dispatched_at >= (SELECT lo FROM bounds)
      AND dispatched_at <  (SELECT hi FROM bounds) + interval '1 minute'
    GROUP BY 1
  )
  SELECT m.minute,
         COALESCE(a.dispatched, 0)::int AS dispatched,
         COALESCE(a.failed, 0)::int AS failed,
         (
           EXTRACT(EPOCH FROM (
             LEAST(
               m.minute + interval '1 minute',
               m.now_ts,
               COALESCE(m.finished_at, m.now_ts + interval '999 days')
             )
             - GREATEST(m.minute, COALESCE(m.started_at, m.minute))
           )) < 59.5
         ) AS is_partial
    FROM minutes m
    LEFT JOIN agg a ON a.minute = m.minute
   ORDER BY m.minute;
$function$;

-- 3) get_broadcast_summary: rate_1m e rate_10m passam a incluir falhas
CREATE OR REPLACE FUNCTION public.get_broadcast_summary(_broadcast_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH t AS (
    SELECT
      count(*) FILTER (WHERE status = 'pending')     AS pending,
      count(*) FILTER (WHERE status = 'processing')  AS processing,
      count(*) FILTER (WHERE status = 'dispatched')  AS dispatched,
      count(*) FILTER (WHERE status = 'failed')      AS failed,
      count(*) FILTER (WHERE status = 'skipped')     AS skipped,
      count(*) FILTER (WHERE status = 'cancelled')   AS cancelled,
      -- Falha de Meta conta como envio para fins de ritmo: o slot foi
      -- consumido pelo motor, então deve aparecer na "taxa real".
      count(*) FILTER (WHERE status IN ('dispatched','failed') AND dispatched_at >= now() - interval '1 minute')   AS rate_1m,
      count(*) FILTER (WHERE status IN ('dispatched','failed') AND dispatched_at >= now() - interval '10 minutes') AS rate_10m,
      max(dispatched_at) FILTER (WHERE status = 'dispatched') AS last_dispatch_at
    FROM public.broadcast_targets
    WHERE broadcast_id = _broadcast_id
  ), q AS (
    SELECT
      count(*) FILTER (WHERE status = 'pending')    AS q_pending,
      count(*) FILTER (WHERE status = 'processing') AS q_processing,
      count(*) FILTER (WHERE status = 'dispatched') AS q_dispatched,
      count(*) FILTER (WHERE status = 'failed')     AS q_failed,
      count(*) FILTER (WHERE status = 'skipped')    AS q_skipped
    FROM public.broadcast_dispatch_queue
    WHERE broadcast_id = _broadcast_id
  )
  SELECT jsonb_build_object(
    'pending_count',    t.pending,
    'processing_count', t.processing,
    'dispatched_count', t.dispatched,
    'failed_count',     t.failed,
    'skipped_count',    t.skipped,
    'cancelled_count',  t.cancelled,
    'rate_last_minute', t.rate_1m,
    'rate_last_10m',    t.rate_10m,
    'last_dispatch_at', t.last_dispatch_at,
    'queue_pending_count',    q.q_pending,
    'queue_processing_count', q.q_processing,
    'queue_dispatched_count', q.q_dispatched,
    'queue_failed_count',     q.q_failed,
    'queue_skipped_count',    q.q_skipped
  )
  FROM t, q;
$function$;
