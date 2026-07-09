SELECT cron.unschedule('pipeline-activities-tick');

SELECT cron.schedule(
  'pipeline-activities-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url:='https://project--6e4da8e7-db19-41db-a13a-c49a88fe3218-dev.lovable.app/api/public/cron/pipeline-activities-tick',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15bm12eWN3aGZleHdoeXp4bnpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDU3MjksImV4cCI6MjA5MzU4MTcyOX0.uBS4WdEcbHB2tO6VqW-EfJI9zNAUMT3-5KWOpTQ6cLk"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);

UPDATE pipeline_contact_activities
   SET status='pending', error_message=NULL
 WHERE id='893ebd8f-2f6e-4b8b-80e4-1f6a7bf73418'
   AND kind='move_stage';