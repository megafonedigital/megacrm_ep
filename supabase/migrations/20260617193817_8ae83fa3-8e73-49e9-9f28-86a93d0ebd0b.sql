CREATE OR REPLACE FUNCTION public.search_pipeline_contacts(
  _user_id uuid,
  _pipeline_id uuid,
  _search text,
  _limit int DEFAULT 20
) RETURNS TABLE (
  id uuid,
  name text,
  profile_name text,
  phone text,
  wa_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pipe AS (
    SELECT brand_id FROM public.pipelines WHERE id = _pipeline_id
  )
  SELECT DISTINCT c.id, c.name, c.profile_name, c.phone, c.wa_id
  FROM public.pipeline_contacts pc
  JOIN public.contacts c ON c.id = pc.contact_id
  JOIN pipe ON true
  WHERE pc.pipeline_id = _pipeline_id
    AND public.has_brand_access(_user_id, pipe.brand_id)
    AND public.can_view_contact_assignment(_user_id, c.id, pipe.brand_id)
    AND (
      coalesce(_search, '') = ''
      OR c.name ILIKE '%' || _search || '%'
      OR c.profile_name ILIKE '%' || _search || '%'
      OR c.phone ILIKE '%' || _search || '%'
      OR c.wa_id ILIKE '%' || _search || '%'
    )
  ORDER BY c.name NULLS LAST
  LIMIT greatest(_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.search_pipeline_contacts(uuid, uuid, text, int) TO authenticated, service_role;