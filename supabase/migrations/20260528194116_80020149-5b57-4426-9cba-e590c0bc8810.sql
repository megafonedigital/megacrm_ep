DROP POLICY IF EXISTS contacts_select_scoped ON public.contacts;

CREATE POLICY contacts_select_scoped ON public.contacts
FOR SELECT
USING (
  (SELECT public.has_brand_access((SELECT auth.uid()), brand_id))
  AND (
    (SELECT public.is_admin((SELECT auth.uid()))
         OR public.has_role((SELECT auth.uid()), 'supervisor'::app_role)
         OR public.has_role((SELECT auth.uid()), 'developer'::app_role))
    OR public.can_view_contact_assignment((SELECT auth.uid()), id, brand_id)
  )
);