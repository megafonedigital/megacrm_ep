
-- Remove jobs antigos (todos apontavam para a URL -dev e usavam pg_sleep)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT jobid FROM cron.job
    WHERE jobname IN (
      'broadcast-tick-0s','broadcast-tick-10s','broadcast-tick-20s',
      'broadcast-tick-30s','broadcast-tick-40s','broadcast-tick-50s',
      'broadcast-reconcile-every-2min'
    )
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

-- Tick principal: 1x/min na URL publicada estável.
-- O motor já processa em micro-lotes internos (até 60/tick) com workers concorrentes.
SELECT cron.schedule(
  'broadcast-tick-every-minute',
  '* * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://megacrm1.lovable.app/api/public/cron/broadcast-tick',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15bm12eWN3aGZleHdoeXp4bnpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDU3MjksImV4cCI6MjA5MzU4MTcyOX0.uBS4WdEcbHB2tO6VqW-EfJI9zNAUMT3-5KWOpTQ6cLk"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 50000
  );
  $cmd$
);

-- Reconcile: a cada 2 min, também na URL estável
SELECT cron.schedule(
  'broadcast-reconcile-every-2min',
  '*/2 * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://megacrm1.lovable.app/api/public/cron/broadcast-reconcile',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15bm12eWN3aGZleHdoeXp4bnpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDU3MjksImV4cCI6MjA5MzU4MTcyOX0.uBS4WdEcbHB2tO6VqW-EfJI9zNAUMT3-5KWOpTQ6cLk"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $cmd$
);
