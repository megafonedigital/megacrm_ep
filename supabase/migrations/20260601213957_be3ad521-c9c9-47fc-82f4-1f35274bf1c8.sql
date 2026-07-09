SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'broadcast-drain-5s-a'),
  command := $cmd$
  SELECT net.http_post(
    url := 'https://project--6e4da8e7-db19-41db-a13a-c49a88fe3218.lovable.app/api/public/cron/broadcast-drain',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15bm12eWN3aGZleHdoeXp4bnpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDU3MjksImV4cCI6MjA5MzU4MTcyOX0.uBS4WdEcbHB2tO6VqW-EfJI9zNAUMT3-5KWOpTQ6cLk"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $cmd$
)
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'broadcast-drain-5s-a');