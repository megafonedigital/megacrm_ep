DROP POLICY IF EXISTS pipeline_contacts_write ON public.pipeline_contacts;

CREATE POLICY pipeline_contacts_insert ON public.pipeline_contacts
FOR INSERT TO authenticated
WITH CHECK (has_brand_access(auth.uid(), brand_id));

CREATE POLICY pipeline_contacts_update ON public.pipeline_contacts
FOR UPDATE TO authenticated
USING (has_brand_access(auth.uid(), brand_id))
WITH CHECK (has_brand_access(auth.uid(), brand_id));

CREATE POLICY pipeline_contacts_delete ON public.pipeline_contacts
FOR DELETE TO authenticated
USING (has_brand_access(auth.uid(), brand_id));