-- Tipos
CREATE TYPE public.sales_tracker_kind AS ENUM ('seller', 'automation');
CREATE TYPE public.sales_tracker_code_kind AS ENUM ('sck', 'utm');

-- Tabela principal: vendedores/automações rastreáveis
CREATE TABLE public.sales_trackers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind public.sales_tracker_kind NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  automation_id uuid REFERENCES public.automations(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT sales_trackers_kind_match CHECK (
    (kind = 'seller' AND automation_id IS NULL)
    OR (kind = 'automation' AND user_id IS NULL)
  )
);

CREATE INDEX idx_sales_trackers_brand ON public.sales_trackers(brand_id);
CREATE INDEX idx_sales_trackers_brand_kind ON public.sales_trackers(brand_id, kind);

CREATE TRIGGER sales_trackers_set_updated
  BEFORE UPDATE ON public.sales_trackers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.sales_trackers ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_trackers_admin_all ON public.sales_trackers
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY sales_trackers_select_member ON public.sales_trackers
  FOR SELECT TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));

CREATE POLICY sales_trackers_write_supervisor ON public.sales_trackers
  FOR ALL TO authenticated
  USING (
    public.has_brand_access(auth.uid(), brand_id)
    AND (public.has_role(auth.uid(), 'supervisor'::app_role) OR public.has_role(auth.uid(), 'developer'::app_role))
  )
  WITH CHECK (
    public.has_brand_access(auth.uid(), brand_id)
    AND (public.has_role(auth.uid(), 'supervisor'::app_role) OR public.has_role(auth.uid(), 'developer'::app_role))
  );

-- Códigos vinculados ao tracker
CREATE TABLE public.sales_tracker_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id uuid NOT NULL REFERENCES public.sales_trackers(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  kind public.sales_tracker_code_kind NOT NULL,
  sck text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  platform_hint text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_tracker_codes_value_check CHECK (
    (kind = 'sck' AND sck IS NOT NULL AND length(trim(sck)) > 0)
    OR (kind = 'utm' AND (
      coalesce(length(trim(utm_source)),0) > 0
      OR coalesce(length(trim(utm_medium)),0) > 0
      OR coalesce(length(trim(utm_campaign)),0) > 0
      OR coalesce(length(trim(utm_content)),0) > 0
      OR coalesce(length(trim(utm_term)),0) > 0
    ))
  )
);

CREATE INDEX idx_sales_tracker_codes_tracker ON public.sales_tracker_codes(tracker_id);
CREATE INDEX idx_sales_tracker_codes_brand_sck ON public.sales_tracker_codes(brand_id, lower(sck)) WHERE kind = 'sck';
CREATE INDEX idx_sales_tracker_codes_brand_utm ON public.sales_tracker_codes(brand_id, lower(utm_campaign), lower(utm_content)) WHERE kind = 'utm';

ALTER TABLE public.sales_tracker_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_tracker_codes_admin_all ON public.sales_tracker_codes
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY sales_tracker_codes_select_member ON public.sales_tracker_codes
  FOR SELECT TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));

CREATE POLICY sales_tracker_codes_write_supervisor ON public.sales_tracker_codes
  FOR ALL TO authenticated
  USING (
    public.has_brand_access(auth.uid(), brand_id)
    AND (public.has_role(auth.uid(), 'supervisor'::app_role) OR public.has_role(auth.uid(), 'developer'::app_role))
  )
  WITH CHECK (
    public.has_brand_access(auth.uid(), brand_id)
    AND (public.has_role(auth.uid(), 'supervisor'::app_role) OR public.has_role(auth.uid(), 'developer'::app_role))
  );