CREATE OR REPLACE FUNCTION public.has_brand_access(_user_id uuid, _brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_admin(_user_id)
    OR public.has_role(_user_id, 'developer'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.brand_channels bc
      JOIN public.channel_agents ca ON ca.channel_id = bc.id
      WHERE bc.brand_id = _brand_id AND ca.user_id = _user_id
    );
$$;