
ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'tag';

ALTER TABLE public.automations
  ADD CONSTRAINT automations_trigger_type_check
  CHECK (trigger_type IN ('tag','manual'));

CREATE TABLE IF NOT EXISTS public.brand_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_brand_api_keys_brand ON public.brand_api_keys(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_api_keys_hash ON public.brand_api_keys(key_hash) WHERE revoked_at IS NULL;

ALTER TABLE public.brand_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_api_keys_admin_all"
  ON public.brand_api_keys
  FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));
