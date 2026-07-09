DROP POLICY IF EXISTS pipeline_contacts_select ON public.pipeline_contacts;

CREATE POLICY pipeline_contacts_select ON public.pipeline_contacts
FOR SELECT TO authenticated
USING (
  has_brand_access(auth.uid(), brand_id)
  AND (
    is_admin(auth.uid())
    OR has_role(auth.uid(), 'supervisor'::app_role)
    OR has_role(auth.uid(), 'developer'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.contact_id = pipeline_contacts.contact_id
        AND c.assigned_to = auth.uid()
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.contact_id = pipeline_contacts.contact_id
        AND c.assigned_to IS NOT NULL
    )
  )
);