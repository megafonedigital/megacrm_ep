CREATE OR REPLACE FUNCTION public.recount_broadcast_progress(_broadcast_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  UPDATE public.broadcasts b SET
    dispatched_count = s.d,
    failed_count     = s.f,
    skipped_count    = s.k,
    status = CASE
      WHEN s.open_count = 0
       AND (s.d + s.f + s.k) > 0
       AND (s.d + s.f + s.k) >= COALESCE(b.total_targets, 0)
       AND b.status = 'running'
      THEN 'completed'::broadcast_status
      ELSE b.status
    END,
    finished_at = CASE
      WHEN s.open_count = 0
       AND (s.d + s.f + s.k) > 0
       AND (s.d + s.f + s.k) >= COALESCE(b.total_targets, 0)
       AND b.status = 'running'
       AND b.finished_at IS NULL
      THEN now()
      ELSE b.finished_at
    END
  FROM (
    SELECT
      count(*) FILTER (WHERE status = 'dispatched') AS d,
      count(*) FILTER (WHERE status = 'failed')     AS f,
      count(*) FILTER (WHERE status = 'skipped')    AS k,
      count(*) FILTER (WHERE status IN ('pending','processing')) AS open_count
    FROM public.broadcast_targets
    WHERE broadcast_id = _broadcast_id
  ) s
  WHERE b.id = _broadcast_id;
$$;