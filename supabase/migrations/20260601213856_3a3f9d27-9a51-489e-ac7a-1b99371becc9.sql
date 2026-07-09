-- Restaura requeue_stuck_broadcast_dispatches para o intervalo de 45s (estado pré-31/05).
-- O valor de 15s introduzido em 01/06 estava devolvendo itens à fila enquanto workers
-- ainda os processavam, criando contenção no hot path do drain.
CREATE OR REPLACE FUNCTION public.requeue_stuck_broadcast_dispatches()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.broadcast_dispatch_queue q
     SET status = 'pending',
         claimed_at = NULL,
         next_attempt_at = now(),
         scheduled_send_at = LEAST(COALESCE(q.scheduled_send_at, now()), now()),
         updated_at = now(),
         last_error = COALESCE(last_error, 'Worker interrompido antes de finalizar')
   WHERE q.status = 'processing'
     AND q.claimed_at < now() - interval '45 seconds'
     AND NOT EXISTS (
       SELECT 1 FROM public.broadcast_targets t
        WHERE t.id = q.target_id AND t.run_id IS NOT NULL
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;