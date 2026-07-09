
CREATE TABLE public.pipeline_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  position integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_folders_brand ON public.pipeline_folders(brand_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_folders TO authenticated;
GRANT ALL ON public.pipeline_folders TO service_role;

ALTER TABLE public.pipeline_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipeline_folders_select_member" ON public.pipeline_folders
  FOR SELECT TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));

CREATE POLICY "pipeline_folders_admin_all" ON public.pipeline_folders
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "pipeline_folders_supervisor_all" ON public.pipeline_folders
  TO authenticated
  USING (public.has_role(auth.uid(), 'supervisor'::app_role) AND public.has_brand_access(auth.uid(), brand_id))
  WITH CHECK (public.has_role(auth.uid(), 'supervisor'::app_role) AND public.has_brand_access(auth.uid(), brand_id));

CREATE POLICY "pipeline_folders_developer_all" ON public.pipeline_folders
  TO authenticated
  USING (public.has_role(auth.uid(), 'developer'::app_role) AND public.has_brand_access(auth.uid(), brand_id))
  WITH CHECK (public.has_role(auth.uid(), 'developer'::app_role) AND public.has_brand_access(auth.uid(), brand_id));

CREATE TRIGGER pipeline_folders_set_updated_at
  BEFORE UPDATE ON public.pipeline_folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.pipelines
  ADD COLUMN folder_id uuid REFERENCES public.pipeline_folders(id) ON DELETE SET NULL;

CREATE INDEX idx_pipelines_brand_folder ON public.pipelines(brand_id, folder_id);

DROP FUNCTION IF EXISTS public.get_pipelines_with_counts(uuid);

CREATE OR REPLACE FUNCTION public.get_pipelines_with_counts(_brand_id uuid)
 RETURNS TABLE(id uuid, brand_id uuid, name text, description text, pos integer, distribution_mode text, distribution_user_ids uuid[], distribution_ai_agent_ids uuid[], brand_name text, stage_count integer, card_count integer, folder_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
      p.id, p.brand_id, p.name, p.description, p.position,
      p.distribution_mode::text, p.distribution_user_ids, p.distribution_ai_agent_ids,
      b.name,
      (SELECT COUNT(*)::int FROM public.pipeline_stages s WHERE s.pipeline_id = p.id),
      (SELECT COUNT(*)::int FROM public.pipeline_contacts pc WHERE pc.pipeline_id = p.id),
      p.folder_id
    FROM public.pipelines p
    LEFT JOIN public.brands b ON b.id = p.brand_id
    WHERE p.brand_id = _brand_id
    ORDER BY p.position ASC, p.created_at ASC;
  ELSE
    RETURN QUERY
    SELECT
      p.id, p.brand_id, p.name, p.description, p.position,
      p.distribution_mode::text, p.distribution_user_ids, p.distribution_ai_agent_ids,
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
      ),
      p.folder_id
    FROM public.pipelines p
    LEFT JOIN public.brands b ON b.id = p.brand_id
    WHERE p.brand_id = _brand_id
    ORDER BY p.position ASC, p.created_at ASC;
  END IF;
END;
$function$;
