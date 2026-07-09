CREATE OR REPLACE FUNCTION public.backfill_stage_activities(_stage_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.pipeline_contact_activities (
    pipeline_contact_id, pipeline_id, stage_id, contact_id, brand_id, activity_id,
    kind, mode, name, message_text, template_id, template_variables, due_at
  )
  SELECT
    pc.id, pc.pipeline_id, pc.stage_id, pc.contact_id, pc.brand_id, sa.id,
    sa.kind, sa.mode, sa.name, sa.message_text, sa.template_id, sa.template_variables,
    now() + make_interval(mins => sa.delay_minutes)
  FROM public.pipeline_contacts pc
  JOIN public.pipeline_stage_activities sa
    ON sa.stage_id = pc.stage_id AND sa.active = true
  WHERE pc.stage_id = _stage_id
    AND pc.status = 'aberto'
    AND NOT EXISTS (
      SELECT 1 FROM public.pipeline_contact_activities pca
      WHERE pca.pipeline_contact_id = pc.id
        AND pca.activity_id = sa.id
        AND pca.status IN ('pending','done','failed','skipped')
    );
END;
$$;