-- 1) Unicidade: cada run pertence a no máximo um broadcast_target
CREATE UNIQUE INDEX IF NOT EXISTS broadcast_targets_run_id_uniq
  ON public.broadcast_targets (run_id)
  WHERE run_id IS NOT NULL;

-- 2) Índice de leitura para reconciliação por run_id recente
CREATE INDEX IF NOT EXISTS broadcast_targets_dispatched_recent_idx
  ON public.broadcast_targets (dispatched_at DESC)
  WHERE status = 'dispatched' AND run_id IS NOT NULL;

-- 3) Requeue só para targets que ainda NÃO criaram run.
--    Se já existe run_id, deixa para o reconciler decidir dispatched/failed.
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
     AND run_id IS NULL
     AND (claimed_at IS NULL OR claimed_at < now() - interval '45 seconds');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- 4) Reconcilia targets que ficaram em processing mas já criaram run
--    (usado pelo cron de reconciliação para promover para dispatched).
CREATE OR REPLACE FUNCTION public.promote_processing_with_run()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_count int;
BEGIN
  UPDATE public.broadcast_targets bt
     SET status = 'dispatched',
         dispatched_at = COALESCE(bt.dispatched_at, now()),
         claimed_at = NULL
   WHERE bt.status = 'processing'
     AND bt.run_id IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_processing_with_run() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_processing_with_run() TO service_role;
