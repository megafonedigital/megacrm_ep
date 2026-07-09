SELECT cron.unschedule('broadcast-drain-every-minute')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'broadcast-drain-every-minute');

SELECT cron.schedule(
  'broadcast-drain-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://megacrm.megafone.digital/api/public/cron/broadcast-drain',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15bm12eWN3aGZleHdoeXp4bnpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDU3MjksImV4cCI6MjA5MzU4MTcyOX0.uBS4WdEcbHB2tO6VqW-EfJI9zNAUMT3-5KWOpTQ6cLk"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 50000
  );
  $$
);