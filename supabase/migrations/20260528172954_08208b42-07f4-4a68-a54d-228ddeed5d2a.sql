CREATE OR REPLACE FUNCTION public.get_broadcast_speed_series(
  _broadcast_id uuid,
  _minutes integer DEFAULT 60
)
RETURNS TABLE(minute timestamptz, dispatched integer, failed integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      GREATEST(LEAST(_minutes, 720), 5) AS mins,
      date_trunc('minute', now()) AS now_min
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
      params.now_min AS window_end
    FROM params, b
  ), bounds AS (
    SELECT
      GREATEST(started_min, window_start) AS lo,
      LEAST(end_min, window_end) AS hi
    FROM range_bounds
  ), minutes AS (
    SELECT generate_series(lo, hi, interval '1 minute') AS minute
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
         COALESCE(a.failed, 0)::int AS failed
    FROM minutes m
    LEFT JOIN agg a ON a.minute = m.minute
   ORDER BY m.minute;
$$;

GRANT EXECUTE ON FUNCTION public.get_broadcast_speed_series(uuid, integer) TO authenticated, service_role;