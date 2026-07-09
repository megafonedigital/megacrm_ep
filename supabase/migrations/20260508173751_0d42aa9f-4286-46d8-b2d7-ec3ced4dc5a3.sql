-- Enum de plataformas
DO $$ BEGIN
  CREATE TYPE public.integration_platform AS ENUM ('shopify', 'hotmart', 'sendflow', 'activecampaign');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.integration_account_status AS ENUM ('active', 'inactive', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabela principal de contas
CREATE TABLE IF NOT EXISTS public.integration_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform public.integration_platform NOT NULL,
  name text NOT NULL,
  status public.integration_account_status NOT NULL DEFAULT 'active',
  credentials jsonb NOT NULL DEFAULT '{}'::jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  webhook_secret text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  polling_enabled boolean NOT NULL DEFAULT false,
  last_event_at timestamptz,
  last_polled_at timestamptz,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_integration_accounts_updated
  BEFORE UPDATE ON public.integration_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.integration_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY integration_accounts_admin_all ON public.integration_accounts
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Vínculo N:N com brands (Experts)
CREATE TABLE IF NOT EXISTS public.integration_account_brands (
  account_id uuid NOT NULL REFERENCES public.integration_accounts(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, brand_id)
);

CREATE INDEX IF NOT EXISTS idx_iab_brand ON public.integration_account_brands(brand_id);

ALTER TABLE public.integration_account_brands ENABLE ROW LEVEL SECURITY;

CREATE POLICY iab_admin_all ON public.integration_account_brands
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY iab_select_member ON public.integration_account_brands
  FOR SELECT TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));

-- Política de leitura de contas para supervisores via vínculo
CREATE POLICY integration_accounts_select_supervisor ON public.integration_accounts
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'supervisor'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.integration_account_brands iab
      WHERE iab.account_id = integration_accounts.id
        AND public.has_brand_access(auth.uid(), iab.brand_id)
    )
  );

-- Cache de produtos/listas/grupos/tags
CREATE TABLE IF NOT EXISTS public.integration_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.integration_accounts(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'product',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, type, external_id)
);

ALTER TABLE public.integration_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY integration_products_admin_all ON public.integration_products
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY integration_products_select_member ON public.integration_products
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.integration_account_brands iab
      WHERE iab.account_id = integration_products.account_id
        AND public.has_brand_access(auth.uid(), iab.brand_id)
    )
  );

-- Eventos recebidos
CREATE TABLE IF NOT EXISTS public.integration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.integration_accounts(id) ON DELETE CASCADE,
  brand_id uuid,
  contact_id uuid,
  event_type text NOT NULL,
  external_id text,
  product_external_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  automations_started integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_integration_events_external
  ON public.integration_events(account_id, event_type, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_integration_events_account_created
  ON public.integration_events(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_integration_events_brand_created
  ON public.integration_events(brand_id, created_at DESC);

ALTER TABLE public.integration_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY integration_events_admin_all ON public.integration_events
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY integration_events_select_member ON public.integration_events
  FOR SELECT TO authenticated
  USING (brand_id IS NOT NULL AND public.has_brand_access(auth.uid(), brand_id));

-- Coluna trigger_config nas automações
ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_automations_trigger_lookup
  ON public.automations(trigger_type, status)
  WHERE status = 'active';