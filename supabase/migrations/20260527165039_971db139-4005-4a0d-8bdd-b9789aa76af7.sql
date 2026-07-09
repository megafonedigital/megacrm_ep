CREATE OR REPLACE FUNCTION public.backfill_stage_activities(_stage_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.pipeline_contact_activities (
    pipeline_contact_id, pipeline_id, stage_id, contact_id, brand_id, activity_id,
    kind, mode, name, message_text, template_id, template_variables, target_stage_id, due_at
  )
  SELECT
    pc.id, pc.pipeline_id, pc.stage_id, pc.contact_id, pc.brand_id, sa.id,
    sa.kind, sa.mode, sa.name, sa.message_text, sa.template_id, sa.template_variables, sa.target_stage_id,
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
$function$;

CREATE OR REPLACE FUNCTION public.tg_pipeline_contact_activities_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_def record;
  v_has_terminal boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR v_def IN
      SELECT * FROM public.pipeline_stage_activities
       WHERE stage_id = NEW.stage_id AND active = true
    LOOP
      SELECT EXISTS (
        SELECT 1 FROM public.pipeline_contact_activities
         WHERE pipeline_contact_id = NEW.id
           AND activity_id = v_def.id
           AND status IN ('done','failed','skipped')
      ) INTO v_has_terminal;

      IF NOT v_has_terminal THEN
        INSERT INTO public.pipeline_contact_activities (
          pipeline_contact_id, pipeline_id, stage_id, contact_id, brand_id, activity_id,
          kind, mode, name, message_text, template_id, template_variables, target_stage_id, due_at
        ) VALUES (
          NEW.id, NEW.pipeline_id, NEW.stage_id, NEW.contact_id, NEW.brand_id, v_def.id,
          v_def.kind, v_def.mode, v_def.name, v_def.message_text, v_def.template_id, v_def.template_variables, v_def.target_stage_id,
          now() + make_interval(mins => v_def.delay_minutes)
        );
      END IF;
    END LOOP;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
      UPDATE public.pipeline_contact_activities
         SET status = 'cancelled', cancel_reason = 'stage_changed', updated_at = now()
       WHERE pipeline_contact_id = NEW.id
         AND stage_id = OLD.stage_id
         AND status = 'pending';

      FOR v_def IN
        SELECT * FROM public.pipeline_stage_activities
         WHERE stage_id = NEW.stage_id AND active = true
      LOOP
        SELECT EXISTS (
          SELECT 1 FROM public.pipeline_contact_activities
           WHERE pipeline_contact_id = NEW.id
             AND activity_id = v_def.id
             AND status IN ('done','failed','skipped')
        ) INTO v_has_terminal;

        IF NOT v_has_terminal THEN
          INSERT INTO public.pipeline_contact_activities (
            pipeline_contact_id, pipeline_id, stage_id, contact_id, brand_id, activity_id,
            kind, mode, name, message_text, template_id, template_variables, target_stage_id, due_at
          ) VALUES (
            NEW.id, NEW.pipeline_id, NEW.stage_id, NEW.contact_id, NEW.brand_id, v_def.id,
            v_def.kind, v_def.mode, v_def.name, v_def.message_text, v_def.template_id, v_def.template_variables, v_def.target_stage_id,
            now() + make_interval(mins => v_def.delay_minutes)
          );
        END IF;
      END LOOP;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('resolvido','perdido') THEN
      UPDATE public.pipeline_contact_activities
         SET status = 'cancelled',
             cancel_reason = CASE WHEN NEW.status = 'perdido' THEN 'lost' ELSE 'resolved' END,
             updated_at = now()
       WHERE pipeline_contact_id = NEW.id AND status = 'pending';
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END $function$;