CREATE INDEX IF NOT EXISTS idx_broadcast_dispatch_queue_claim
ON public.broadcast_dispatch_queue (scheduled_send_at, next_attempt_at, created_at)
WHERE status = 'pending';