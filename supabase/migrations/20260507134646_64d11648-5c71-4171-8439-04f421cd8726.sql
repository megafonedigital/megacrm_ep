DROP POLICY IF EXISTS "Admin/supervisor manage automations" ON public.automations;

CREATE POLICY "Admin/supervisor manage automations"
ON public.automations
FOR ALL
TO authenticated
USING (
  has_brand_access(auth.uid(), brand_id)
  AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'supervisor'::app_role))
)
WITH CHECK (
  has_brand_access(auth.uid(), brand_id)
  AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'supervisor'::app_role))
);