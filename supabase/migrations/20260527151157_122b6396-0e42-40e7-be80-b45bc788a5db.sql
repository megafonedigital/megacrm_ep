
CREATE TABLE public.contact_blocklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('phone','email')),
  value text NOT NULL,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, kind, value)
);

CREATE INDEX idx_contact_blocklist_lookup ON public.contact_blocklist (brand_id, value);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_blocklist TO authenticated;
GRANT ALL ON public.contact_blocklist TO service_role;

ALTER TABLE public.contact_blocklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY blocklist_select ON public.contact_blocklist
  FOR SELECT TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));

CREATE POLICY blocklist_insert ON public.contact_blocklist
  FOR INSERT TO authenticated
  WITH CHECK (public.has_brand_access(auth.uid(), brand_id));

CREATE POLICY blocklist_update ON public.contact_blocklist
  FOR UPDATE TO authenticated
  USING (
    public.has_brand_access(auth.uid(), brand_id)
    AND (
      public.is_admin(auth.uid())
      OR public.has_role(auth.uid(), 'supervisor'::app_role)
      OR public.has_role(auth.uid(), 'developer'::app_role)
    )
  )
  WITH CHECK (public.has_brand_access(auth.uid(), brand_id));

CREATE POLICY blocklist_delete ON public.contact_blocklist
  FOR DELETE TO authenticated
  USING (
    public.has_brand_access(auth.uid(), brand_id)
    AND (
      public.is_admin(auth.uid())
      OR public.has_role(auth.uid(), 'supervisor'::app_role)
      OR public.has_role(auth.uid(), 'developer'::app_role)
    )
  );

CREATE OR REPLACE FUNCTION public.is_blocked(_brand uuid, _phone text, _email text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.contact_blocklist b
    WHERE b.brand_id = _brand
      AND (
        (_phone IS NOT NULL AND b.kind = 'phone' AND b.value = _phone)
        OR (_email IS NOT NULL AND b.kind = 'email' AND b.value = lower(_email))
      )
  );
$$;
