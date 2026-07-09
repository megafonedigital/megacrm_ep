UPDATE public.broadcast_targets bt
SET status = 'pending', error = NULL, claimed_at = NULL, run_id = NULL
WHERE bt.broadcast_id = 'b840778f-4934-4ace-a45d-2d1bfaa376c6'
  AND bt.status = 'failed'
  AND bt.error = 'Contato não encontrado'
  AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = bt.contact_id);

UPDATE public.broadcast_dispatch_queue q
SET status = 'pending', claimed_at = NULL, last_error = NULL, next_attempt_at = now()
WHERE q.broadcast_id = 'b840778f-4934-4ace-a45d-2d1bfaa376c6'
  AND q.status = 'failed'
  AND EXISTS (
    SELECT 1 FROM public.broadcast_targets bt
    WHERE bt.id = q.target_id AND bt.status = 'pending'
  );