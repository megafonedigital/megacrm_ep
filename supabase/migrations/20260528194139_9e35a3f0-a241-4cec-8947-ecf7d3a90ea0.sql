DROP POLICY IF EXISTS conversations_select ON public.conversations;

CREATE POLICY conversations_select ON public.conversations
FOR SELECT
USING (
  (SELECT public.is_admin((SELECT auth.uid())))
  OR (
    (SELECT public.has_role((SELECT auth.uid()), 'supervisor'::app_role))
    AND (SELECT public.has_brand_access((SELECT auth.uid()), brand_id))
  )
  OR (
    (SELECT public.has_brand_access((SELECT auth.uid()), brand_id))
    AND (assigned_to = (SELECT auth.uid()) OR assigned_to IS NULL)
  )
);