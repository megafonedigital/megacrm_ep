
-- 1. Colunas em integration_accounts
ALTER TABLE public.integration_accounts
  ADD COLUMN IF NOT EXISTS rate_limit_per_minute integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS rate_limit_burst integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS queue_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_drain_at timestamptz;

-- Defaults sensatos por plataforma para contas existentes
UPDATE public.integration_accounts
   SET rate_limit_per_minute = CASE platform::text
         WHEN 'sendflow' THEN 120
         WHEN 'activecampaign' THEN 60
         WHEN 'hotmart' THEN 30
         ELSE 30 END,
       rate_limit_burst = CASE platform::text
         WHEN 'sendflow' THEN 30
         WHEN 'activecampaign' THEN 20
         WHEN 'hotmart' THEN 10
         ELSE 10 END
 WHERE rate_limit_per_minute = 30 AND rate_limit_burst = 10;

-- 2. Tabela de fila
CREATE TABLE IF NOT EXISTS public.integration_event_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.integration_accounts(id) ON DELETE CASCADE,
  platform integration_platform NOT NULL,
  event_type text,
  external_id text,
  payload jsonb NOT NULL,
  signature_header text,
  status text NOT NULL DEFAULT 'pending', -- pending | processing | done | failed | skipped
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ieq_pending
  ON public.integration_event_queue (account_id, next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_ieq_status_received
  ON public.integration_event_queue (status, received_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ieq_account_external
  ON public.integration_event_queue (account_id, external_id)
  WHERE external_id IS NOT NULL;

-- 3. RLS
ALTER TABLE public.integration_event_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY ieq_admin_all
  ON public.integration_event_queue
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY ieq_select_member
  ON public.integration_event_queue
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.integration_account_brands iab
      WHERE iab.account_id = integration_event_queue.account_id
        AND has_brand_access(auth.uid(), iab.brand_id)
    )
  );
