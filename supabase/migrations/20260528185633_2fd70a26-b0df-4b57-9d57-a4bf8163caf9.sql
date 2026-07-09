CREATE OR REPLACE FUNCTION public.release_broadcast_dispatch_no_penalty(
  _queue_id uuid,
  _target_id uuid,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.broadcast_dispatch_queue
     SET status = 'pending',
         claimed_at = NULL,
         next_attempt_at = now(),
         attempts = GREATEST(attempts - 1, 0),
         last_error = LEFT(COALESCE(_reason, 'Liberado sem penalidade'), 500),
         updated_at = now()
   WHERE id = _queue_id
     AND target_id = _target_id
     AND status = 'processing';
END;
$function$;