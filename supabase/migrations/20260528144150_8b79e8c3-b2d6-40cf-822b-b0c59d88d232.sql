
-- Índices para listagem paginada por broadcast (acelera ordenação)
CREATE INDEX IF NOT EXISTS broadcast_targets_broadcast_created_idx
  ON public.broadcast_targets (broadcast_id, created_at);

CREATE INDEX IF NOT EXISTS broadcast_targets_broadcast_dispatched_idx
  ON public.broadcast_targets (broadcast_id, dispatched_at DESC NULLS LAST);

-- Função agregada única para o resumo de um broadcast
CREATE OR REPLACE FUNCTION public.get_broadcast_summary(_broadcast_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT
      count(*) FILTER (WHERE status = 'pending')     AS pending,
      count(*) FILTER (WHERE status = 'processing')  AS processing,
      count(*) FILTER (WHERE status = 'dispatched')  AS dispatched,
      count(*) FILTER (WHERE status = 'failed')      AS failed,
      count(*) FILTER (WHERE status = 'skipped')     AS skipped,
      count(*) FILTER (WHERE status = 'cancelled')   AS cancelled,
      count(*) FILTER (WHERE status = 'dispatched' AND dispatched_at >= now() - interval '1 minute')   AS rate_1m,
      count(*) FILTER (WHERE status = 'dispatched' AND dispatched_at >= now() - interval '10 minutes') AS rate_10m,
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
$$;

GRANT EXECUTE ON FUNCTION public.get_broadcast_summary(uuid) TO authenticated, service_role;
