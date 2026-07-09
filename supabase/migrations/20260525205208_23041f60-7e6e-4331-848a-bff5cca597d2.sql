DROP POLICY IF EXISTS conversations_update ON public.conversations;

CREATE POLICY conversations_update ON public.conversations
FOR UPDATE
USING (
  public.is_admin(auth.uid())
  OR (public.has_role(auth.uid(), 'supervisor'::app_role) AND public.has_brand_access(auth.uid(), brand_id))
  OR (public.has_brand_access(auth.uid(), brand_id) AND (assigned_to = auth.uid() OR assigned_to IS NULL))
)
WITH CHECK (
  public.is_admin(auth.uid())
  OR (public.has_role(auth.uid(), 'supervisor'::app_role) AND public.has_brand_access(auth.uid(), brand_id))
  OR public.has_brand_access(auth.uid(), brand_id)
);