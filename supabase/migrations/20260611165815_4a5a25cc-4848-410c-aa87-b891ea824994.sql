
-- Função de limpeza
CREATE OR REPLACE FUNCTION public.cleanup_automation_runs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cancelled_waiting int := 0;
  v_failed_running int := 0;
  v_deleted_terminal int := 0;
BEGIN
  -- 1) Cancela waiting_button parados há > 14 dias
  UPDATE public.automation_runs
     SET status = 'cancelled',
         finished_at = COALESCE(finished_at, now()),
         last_error = COALESCE(last_error, 'auto-cancelled: timeout aguardando botão')
   WHERE status = 'waiting_button'
     AND updated_at < now() - interval '14 days';
  GET DIAGNOSTICS v_cancelled_waiting = ROW_COUNT;

  -- 2) Marca como failed runs "running" travados há > 24h
  UPDATE public.automation_runs
     SET status = 'failed',
         finished_at = COALESCE(finished_at, now()),
         last_error = COALESCE(last_error, 'auto-failed: execução travada > 24h')
   WHERE status = 'running'
     AND updated_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_failed_running = ROW_COUNT;

  -- 3) Deleta runs terminais > 30 dias (steps caem via ON DELETE CASCADE)
  DELETE FROM public.automation_runs
   WHERE status IN ('completed', 'failed', 'cancelled')
     AND COALESCE(finished_at, updated_at) < now() - interval '30 days';
  GET DIAGNOSTICS v_deleted_terminal = ROW_COUNT;

  RETURN jsonb_build_object(
    'cancelled_waiting_button', v_cancelled_waiting,
    'failed_stuck_running', v_failed_running,
    'deleted_terminal', v_deleted_terminal,
    'ran_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_automation_runs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_automation_runs() TO service_role;

-- Garante extensão pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove agendamento anterior se existir, depois agenda
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-automation-runs-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-automation-runs-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cleanup-automation-runs-daily',
  '0 3 * * *',
  $$ SELECT public.cleanup_automation_runs(); $$
);

-- Execução inicial para limpar o acumulado
SELECT public.cleanup_automation_runs();
