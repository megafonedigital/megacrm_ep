-- Coluna de timestamp da reserva
ALTER TABLE public.broadcast_targets
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS broadcast_targets_processing_idx
  ON public.broadcast_targets (status, claimed_at)
  WHERE status = 'processing';

-- Reserva atômica de targets pendentes (FOR UPDATE SKIP LOCKED)
CREATE OR REPLACE FUNCTION public.claim_broadcast_targets(_broadcast_id uuid, _limit int)
RETURNS TABLE(id uuid, contact_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT t.id
      FROM public.broadcast_targets t
     WHERE t.broadcast_id = _broadcast_id
       AND t.status = 'pending'
     ORDER BY t.created_at
     LIMIT GREATEST(_limit, 0)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.broadcast_targets bt
     SET status = 'processing',
         claimed_at = now()
    FROM picked
   WHERE bt.id = picked.id
   RETURNING bt.id, bt.contact_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_broadcast_targets(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_broadcast_targets(uuid, int) TO service_role;

-- Devolve para `pending` qualquer target preso em `processing` por mais de 5 minutos
CREATE OR REPLACE FUNCTION public.requeue_stuck_broadcast_targets()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  UPDATE public.broadcast_targets
     SET status = 'pending',
         claimed_at = NULL
   WHERE status = 'processing'
     AND claimed_at < now() - interval '5 minutes';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.requeue_stuck_broadcast_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_stuck_broadcast_targets() TO service_role;
