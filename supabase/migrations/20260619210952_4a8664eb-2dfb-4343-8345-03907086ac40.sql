UPDATE public.broadcast_dispatch_queue q
SET status = 'pending', claimed_at = NULL, last_error = NULL, next_attempt_at = NULL
WHERE q.broadcast_id = 'b840778f-4934-4ace-a45d-2d1bfaa376c6'
  AND q.status = 'failed'
  AND EXISTS (
    SELECT 1 FROM public.broadcast_targets bt
    WHERE bt.id = q.target_id AND bt.status = 'pending'
  );