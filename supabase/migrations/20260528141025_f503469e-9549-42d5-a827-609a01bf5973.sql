
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT jobid FROM cron.job
    WHERE jobname IN ('broadcast-tick-every-minute','broadcast-reconcile-every-2min')
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'broadcast-tick-every-minute',
  '* * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://megacrm.megafone.digital/api/public/cron/broadcast-tick',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15bm12eWN3aGZleHdoeXp4bnpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDU3MjksImV4cCI6MjA5MzU4MTcyOX0.uBS4WdEcbHB2tO6VqW-EfJI9zNAUMT3-5KWOpTQ6cLk"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 50000
  );
  $cmd$
);

SELECT cron.schedule(
  'broadcast-reconcile-every-2min',
  '*/2 * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://megacrm.megafone.digital/api/public/cron/broadcast-reconcile',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15bm12eWN3aGZleHdoeXp4bnpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDU3MjksImV4cCI6MjA5MzU4MTcyOX0.uBS4WdEcbHB2tO6VqW-EfJI9zNAUMT3-5KWOpTQ6cLk"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $cmd$
);
