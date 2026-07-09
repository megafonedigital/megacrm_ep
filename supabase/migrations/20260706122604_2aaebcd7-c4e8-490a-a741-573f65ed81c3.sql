SELECT cron.unschedule('broadcast-loop-2s')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'broadcast-loop-2s');

SELECT cron.schedule(
  'broadcast-loop-2s',
  '2 seconds',
  $cron$
  SELECT
    net.http_post(
      url:='https://project--6e4da8e7-db19-41db-a13a-c49a88fe3218.lovable.app/api/public/cron/broadcast-loop',
      headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15bm12eWN3aGZleHdoeXp4bnpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDU3MjksImV4cCI6MjA5MzU4MTcyOX0.uBS4WdEcbHB2tO6VqW-EfJI9zNAUMT3-5KWOpTQ6cLk"}'::jsonb,
      body:='{}'::jsonb
    ),
    net.http_post(
      url:='https://project--6e4da8e7-db19-41db-a13a-c49a88fe3218.lovable.app/api/public/cron/broadcast-loop',
      headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15bm12eWN3aGZleHdoeXp4bnpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDU3MjksImV4cCI6MjA5MzU4MTcyOX0.uBS4WdEcbHB2tO6VqW-EfJI9zNAUMT3-5KWOpTQ6cLk"}'::jsonb,
      body:='{}'::jsonb
    ),
    net.http_post(
      url:='https://project--6e4da8e7-db19-41db-a13a-c49a88fe3218.lovable.app/api/public/cron/broadcast-loop',
      headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15bm12eWN3aGZleHdoeXp4bnpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDU3MjksImV4cCI6MjA5MzU4MTcyOX0.uBS4WdEcbHB2tO6VqW-EfJI9zNAUMT3-5KWOpTQ6cLk"}'::jsonb,
      body:='{}'::jsonb
    );
  $cron$
);