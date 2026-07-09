
-- Função que expira runs antigos em waiting_button
CREATE OR REPLACE FUNCTION public.expire_stale_waiting_button_runs()
RETURNS TABLE(expired_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
BEGIN
  WITH expired AS (
    UPDATE public.automation_runs
    SET status = 'expired',
        last_error = 'expired: waiting_button > 14 dias sem clique',
        finished_at = now(),
        updated_at = now()
    WHERE status = 'waiting_button'
      AND started_at < now() - interval '14 days'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM expired;

  DELETE FROM public.automation_scheduled_steps
  WHERE run_id IN (
    SELECT id FROM public.automation_runs
    WHERE status = 'expired'
      AND last_error = 'expired: waiting_button > 14 dias sem clique'
      AND finished_at > now() - interval '5 minutes'
  );

  RETURN QUERY SELECT v_count;
END;
$$;

-- Garantir pg_cron disponível
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remover job anterior se existir (idempotência)
DO $$
BEGIN
  PERFORM cron.unschedule('expire-stale-waiting-button-runs');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- Agendar diariamente às 03:00 UTC
SELECT cron.schedule(
  'expire-stale-waiting-button-runs',
  '0 3 * * *',
  $$ SELECT public.expire_stale_waiting_button_runs(); $$
);
