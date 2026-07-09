ALTER TABLE public.integration_products
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS integration_products_account_type_extid_uniq
  ON public.integration_products (account_id, type, external_id);