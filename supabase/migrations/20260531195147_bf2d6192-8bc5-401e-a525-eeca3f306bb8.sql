CREATE OR REPLACE FUNCTION public.get_broadcast_summary(_broadcast_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH b AS (
    SELECT COALESCE(finished_at, now()) AS anchor
      FROM public.broadcasts
     WHERE id = _broadcast_id
  ), t AS (
    SELECT
      count(*) FILTER (WHERE status = 'pending')     AS pending,
      count(*) FILTER (WHERE status = 'processing')  AS processing,
      count(*) FILTER (WHERE status = 'dispatched')  AS dispatched,
      count(*) FILTER (WHERE status = 'failed')      AS failed,
      count(*) FILTER (WHERE status = 'skipped')     AS skipped,
      count(*) FILTER (WHERE status = 'cancelled')   AS cancelled,
      count(*) FILTER (WHERE status IN ('dispatched','failed') AND dispatched_at >  (SELECT anchor FROM b) - interval '1 minute'  AND dispatched_at <= (SELECT anchor FROM b)) AS rate_1m,
      count(*) FILTER (WHERE status IN ('dispatched','failed') AND dispatched_at >  (SELECT anchor FROM b) - interval '10 minutes' AND dispatched_at <= (SELECT anchor FROM b)) AS rate_10m,
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
      -- Quando o broadcast terminou, fixamos a janela em [started_at, finished_at]
      -- para que o histórico não escorregue com o tempo. Caso contrário, usamos
      -- a janela deslizante padrão dos últimos _minutes.
      CASE
        WHEN b.finished_at IS NOT NULL THEN COALESCE(date_trunc('minute', b.started_at), params.now_min - make_interval(mins => params.mins))
        ELSE COALESCE(date_trunc('minute', b.started_at), params.now_min - make_interval(mins => params.mins))
      END AS started_min,
      CASE
        WHEN b.finished_at IS NOT NULL THEN date_trunc('minute', b.finished_at)
        ELSE params.now_min
      END AS end_min,
      CASE
        WHEN b.finished_at IS NOT NULL THEN COALESCE(date_trunc('minute', b.started_at), params.now_min - make_interval(mins => params.mins))
        ELSE params.now_min - make_interval(mins => params.mins)
      END AS window_start,
      CASE
        WHEN b.finished_at IS NOT NULL THEN date_trunc('minute', b.finished_at)
        ELSE params.now_min
      END AS window_end,
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