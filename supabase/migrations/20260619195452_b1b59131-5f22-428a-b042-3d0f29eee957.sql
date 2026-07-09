
-- Hotmart products allow-list
CREATE TABLE public.ellie_hotmart_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  label text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, product_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ellie_hotmart_products TO authenticated;
GRANT ALL ON public.ellie_hotmart_products TO service_role;

ALTER TABLE public.ellie_hotmart_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ellie_hotmart_products_admin_all" ON public.ellie_hotmart_products
  TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY "ellie_hotmart_products_select_member" ON public.ellie_hotmart_products
  FOR SELECT TO authenticated USING (has_brand_access(auth.uid(), brand_id));
CREATE POLICY "ellie_hotmart_products_write_supervisor" ON public.ellie_hotmart_products
  TO authenticated
  USING (has_brand_access(auth.uid(), brand_id) AND (has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role)))
  WITH CHECK (has_brand_access(auth.uid(), brand_id) AND (has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role)));

CREATE TRIGGER trg_ellie_hotmart_products_updated_at
  BEFORE UPDATE ON public.ellie_hotmart_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Hotmart OAuth token cache
CREATE TABLE public.ellie_hotmart_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL UNIQUE REFERENCES public.brands(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.ellie_hotmart_tokens TO service_role;
-- no authenticated grants: only the server (service_role) reads/writes this cache

ALTER TABLE public.ellie_hotmart_tokens ENABLE ROW LEVEL SECURITY;

-- Extra columns on existing validations table
ALTER TABLE public.ellie_buyer_validations
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS matched_product_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS raw_response jsonb,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz;
