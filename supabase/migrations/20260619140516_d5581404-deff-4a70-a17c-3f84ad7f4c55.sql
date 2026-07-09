CREATE OR REPLACE FUNCTION public.check_broadcast_rate_compliance(_broadcast_id uuid)
RETURNS TABLE (
  minute timestamptz,
  dispatched bigint,
  configured integer,
  ratio numeric,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH b AS (
    SELECT COALESCE(rate_per_minute, 0) AS rpm
    FROM public.broadcasts
    WHERE id = _broadcast_id
  ),
  buckets AS (
    SELECT date_trunc('minute', dispatched_at) AS minute, COUNT(*) AS dispatched
    FROM public.broadcast_targets
    WHERE broadcast_id = _broadcast_id
      AND dispatched_at IS NOT NULL
    GROUP BY 1
  )
  SELECT
    bk.minute,
    bk.dispatched,
    b.rpm AS configured,
    CASE WHEN b.rpm > 0 THEN ROUND(bk.dispatched::numeric / b.rpm, 3) ELSE NULL END AS ratio,
    CASE
      WHEN b.rpm = 0 THEN 'unknown'
      WHEN bk.dispatched::numeric / b.rpm > 1.20 THEN 'critical'
      WHEN bk.dispatched::numeric / b.rpm > 1.05 THEN 'over'
      ELSE 'ok'
    END AS status
  FROM buckets bk CROSS JOIN b
  ORDER BY bk.minute;
$$;

GRANT EXECUTE ON FUNCTION public.check_broadcast_rate_compliance(uuid) TO authenticated, service_role;