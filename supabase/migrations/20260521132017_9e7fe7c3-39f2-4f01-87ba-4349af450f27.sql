DROP POLICY IF EXISTS contacts_select_brand ON public.contacts;

CREATE POLICY contacts_select_scoped ON public.contacts
FOR SELECT TO authenticated
USING (
  has_brand_access(auth.uid(), brand_id)
  AND (
    is_admin(auth.uid())
    OR has_role(auth.uid(), 'supervisor'::app_role)
    OR has_role(auth.uid(), 'developer'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.contact_id = contacts.id
        AND c.assigned_to = auth.uid()
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.contact_id = contacts.id
        AND c.assigned_to IS NOT NULL
    )
  )
);