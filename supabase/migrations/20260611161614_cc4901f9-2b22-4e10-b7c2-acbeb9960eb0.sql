
-- §1 Índices compostos para queries quentes
CREATE INDEX IF NOT EXISTS idx_conversations_brand_unread
  ON public.conversations (brand_id)
  WHERE unread_count > 0;

CREATE INDEX IF NOT EXISTS idx_conversations_brand_lastmsg
  ON public.conversations (brand_id, last_message_at DESC)
  WHERE last_message_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_brand_status_lastmsg
  ON public.conversations (brand_id, status, last_message_at DESC)
  WHERE last_message_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pipeline_contacts_pipeline_stage_pos
  ON public.pipeline_contacts (pipeline_id, stage_id, position);

CREATE INDEX IF NOT EXISTS idx_pipeline_contacts_brand
  ON public.pipeline_contacts (brand_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_contact_activities_pipeline_status
  ON public.pipeline_contact_activities (pipeline_id, status);

CREATE INDEX IF NOT EXISTS idx_integration_products_account_type_name
  ON public.integration_products (account_id, type, lower(name));

CREATE INDEX IF NOT EXISTS idx_api_request_logs_created_at
  ON public.api_request_logs (created_at);

ANALYZE public.conversations;
ANALYZE public.pipeline_contacts;
ANALYZE public.pipeline_contact_activities;
ANALYZE public.integration_products;

-- §3 Job de retenção de logs (>30 dias)
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('purge-api-request-logs')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-api-request-logs');

SELECT cron.schedule(
  'purge-api-request-logs',
  '0 3 * * *',
  $$DELETE FROM public.api_request_logs WHERE created_at < now() - interval '30 days'$$
);
