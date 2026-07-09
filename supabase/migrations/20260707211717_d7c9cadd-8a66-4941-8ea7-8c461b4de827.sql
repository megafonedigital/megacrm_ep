DROP FUNCTION IF EXISTS public.get_pipelines_with_counts(uuid);

CREATE OR REPLACE FUNCTION public.get_pipelines_with_counts(_brand_id uuid)
RETURNS TABLE(
  id uuid,
  brand_id uuid,
  name text,
  description text,
  pos integer,
  distribution_mode text,
  distribution_user_ids uuid[],
  distribution_ai_agent_ids uuid[],
  brand_name text,
  stage_count integer,
  card_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _privileged boolean;
BEGIN
  IF _uid IS NULL OR NOT public.has_brand_access(_uid, _brand_id) THEN
    RETURN;
  END IF;

  _privileged := public.is_admin(_uid)
    OR public.has_role(_uid, 'supervisor'::app_role)
    OR public.has_role(_uid, 'developer'::app_role);

  IF _privileged THEN
    RETURN QUERY
    SELECT
      p.id,
      p.brand_id,
      p.name,
      p.description,
      p.position,
      p.distribution_mode::text,
      p.distribution_user_ids,
      p.distribution_ai_agent_ids,
      b.name,
      (SELECT COUNT(*)::int FROM public.pipeline_stages s WHERE s.pipeline_id = p.id),
      (SELECT COUNT(*)::int FROM public.pipeline_contacts pc WHERE pc.pipeline_id = p.id)
    FROM public.pipelines p
    LEFT JOIN public.brands b ON b.id = p.brand_id
    WHERE p.brand_id = _brand_id
    ORDER BY p.position ASC, p.created_at ASC;
  ELSE
    RETURN QUERY
    SELECT
      p.id,
      p.brand_id,
      p.name,
      p.description,
      p.position,
      p.distribution_mode::text,
      p.distribution_user_ids,
      p.distribution_ai_agent_ids,
      b.name,
      (SELECT COUNT(*)::int FROM public.pipeline_stages s WHERE s.pipeline_id = p.id),
      (
        SELECT COUNT(*)::int
        FROM public.pipeline_contacts pc
        WHERE pc.pipeline_id = p.id
          AND (
            EXISTS (
              SELECT 1 FROM public.conversations c
              WHERE c.contact_id = pc.contact_id
                AND c.brand_id = pc.brand_id
                AND c.assigned_to = _uid
            )
            OR NOT EXISTS (
              SELECT 1 FROM public.conversations c
              WHERE c.contact_id = pc.contact_id
                AND c.brand_id = pc.brand_id
                AND c.assigned_to IS NOT NULL
            )
          )
      )
    FROM public.pipelines p
    LEFT JOIN public.brands b ON b.id = p.brand_id
    WHERE p.brand_id = _brand_id
    ORDER BY p.position ASC, p.created_at ASC;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_pipelines_with_counts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pipelines_with_counts(uuid) TO service_role;