
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- remove agendamentos antigos se existirem
DO $$
BEGIN
  PERFORM cron.unschedule('ai-agents-drain-30s');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'ai-agents-drain-30s',
  '30 seconds',
  $job$
  SELECT net.http_post(
    url := 'https://project--6e4da8e7-db19-41db-a13a-c49a88fe3218.lovable.app/api/public/cron/ai-agents-drain',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15bm12eWN3aGZleHdoeXp4bnpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDU3MjksImV4cCI6MjA5MzU4MTcyOX0.uBS4WdEcbHB2tO6VqW-EfJI9zNAUMT3-5KWOpTQ6cLk"}'::jsonb,
    body := '{}'::jsonb
  );
  $job$
);
