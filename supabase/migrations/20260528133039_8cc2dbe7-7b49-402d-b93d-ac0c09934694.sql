CREATE OR REPLACE FUNCTION public.requeue_stuck_broadcast_targets()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count int;
BEGIN
  UPDATE public.broadcast_targets
     SET status = 'pending',
         claimed_at = NULL
   WHERE status = 'processing'
     AND (claimed_at IS NULL OR claimed_at < now() - interval '30 seconds');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;