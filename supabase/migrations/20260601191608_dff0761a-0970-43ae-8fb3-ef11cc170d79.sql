-- 1) Bulk release helper: devolve vários itens à fila sem penalizar attempts.
CREATE OR REPLACE FUNCTION public.release_broadcast_dispatches_bulk(
  _queue_ids uuid[],
  _reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_targets integer := 0;
  affected_queue integer := 0;
BEGIN
  IF _queue_ids IS NULL OR array_length(_queue_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- Devolve targets vinculados a status pending e limpa claimed_at.
  UPDATE public.broadcast_targets bt
     SET status = 'pending',
         claimed_at = NULL,
         error = left(_reason, 500)
    FROM public.broadcast_dispatch_queue q
   WHERE q.id = ANY(_queue_ids)
     AND bt.id = q.target_id
     AND bt.status IN ('pending', 'processing');
  GET DIAGNOSTICS affected_targets = ROW_COUNT;

  -- Decrementa attempts (revertendo o incremento do claim) e devolve a pending.
  UPDATE public.broadcast_dispatch_queue
     SET status = 'pending',
         attempts = GREATEST(attempts - 1, 0),
         claimed_at = NULL,
         last_error = left(_reason, 500),
         updated_at = now()
   WHERE id = ANY(_queue_ids);
  GET DIAGNOSTICS affected_queue = ROW_COUNT;

  RETURN affected_queue;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_broadcast_dispatches_bulk(uuid[], text) TO service_role;

-- 2) One-shot: libera os ~200 itens travados em processing do broadcast atual.
UPDATE public.broadcast_dispatch_queue
   SET status = 'pending',
       attempts = 0,
       claimed_at = NULL,
       last_error = NULL,
       updated_at = now()
 WHERE broadcast_id = 'eb020b2a-07df-45dd-a454-4b4397b73af2'
   AND status = 'processing';

UPDATE public.broadcast_targets
   SET status = 'pending',
       claimed_at = NULL,
       error = NULL
 WHERE broadcast_id = 'eb020b2a-07df-45dd-a454-4b4397b73af2'
   AND status = 'processing'
   AND run_id IS NULL;