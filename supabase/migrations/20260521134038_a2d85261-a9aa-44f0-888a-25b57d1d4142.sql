-- Função SECURITY DEFINER que avalia se o usuário pode ver um contato
-- segundo as regras: admin/supervisor/developer veem tudo do workspace;
-- agente vê se a conversa do contato no brand está atribuída a ele, ou se
-- nenhuma conversa do contato no brand tem assigned_to preenchido.
-- Usa SECURITY DEFINER para contornar o RLS de conversations dentro da policy.
CREATE OR REPLACE FUNCTION public.can_view_contact_assignment(_user_id uuid, _contact_id uuid, _brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_brand_access(_user_id, _brand_id)
    AND (
      public.is_admin(_user_id)
      OR public.has_role(_user_id, 'supervisor'::app_role)
      OR public.has_role(_user_id, 'developer'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.contact_id = _contact_id
          AND c.brand_id   = _brand_id
          AND c.assigned_to = _user_id
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.contact_id = _contact_id
          AND c.brand_id   = _brand_id
          AND c.assigned_to IS NOT NULL
      )
    );
$$;

-- Substitui as policies de SELECT em contacts e pipeline_contacts
DROP POLICY IF EXISTS contacts_select_scoped ON public.contacts;
CREATE POLICY contacts_select_scoped ON public.contacts
FOR SELECT TO authenticated
USING (public.can_view_contact_assignment(auth.uid(), id, brand_id));

DROP POLICY IF EXISTS pipeline_contacts_select ON public.pipeline_contacts;
CREATE POLICY pipeline_contacts_select ON public.pipeline_contacts
FOR SELECT TO authenticated
USING (public.can_view_contact_assignment(auth.uid(), contact_id, brand_id));