-- 1) Permite status 'perdido' nos cartões
ALTER TABLE public.pipeline_contacts
  DROP CONSTRAINT IF EXISTS pipeline_contacts_status_check;
ALTER TABLE public.pipeline_contacts
  ADD CONSTRAINT pipeline_contacts_status_check
  CHECK (status IN ('aberto','resolvido','perdido'));

-- 2) Configuração por etapa
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS on_enter_status text NOT NULL DEFAULT 'none'
  CHECK (on_enter_status IN ('none','resolvido','perdido'));

-- 3) Trigger: aplica on_enter_status ao entrar em uma etapa
CREATE OR REPLACE FUNCTION public.tg_pipeline_contact_apply_stage_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_on_enter text;
BEGIN
  IF TG_OP = 'INSERT'
     OR (TG_OP = 'UPDATE' AND NEW.stage_id IS DISTINCT FROM OLD.stage_id) THEN
    SELECT on_enter_status INTO v_on_enter
      FROM public.pipeline_stages
     WHERE id = NEW.stage_id;
    IF v_on_enter IS NOT NULL AND v_on_enter <> 'none' THEN
      NEW.status := v_on_enter;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS pipeline_contacts_apply_stage_status ON public.pipeline_contacts;
CREATE TRIGGER pipeline_contacts_apply_stage_status
  BEFORE INSERT OR UPDATE ON public.pipeline_contacts
  FOR EACH ROW EXECUTE FUNCTION public.tg_pipeline_contact_apply_stage_status();

-- 4) Atualiza event_type para aceitar 'lost'
ALTER TABLE public.pipeline_contact_events
  DROP CONSTRAINT IF EXISTS pipeline_contact_events_event_type_check;
ALTER TABLE public.pipeline_contact_events
  ADD CONSTRAINT pipeline_contact_events_event_type_check
  CHECK (event_type IN ('added','moved','resolved','reopened','removed','lost'));

-- 5) Atualiza trigger de log: emite 'lost' / 'resolved' / 'reopened'
CREATE OR REPLACE FUNCTION public.tg_log_pipeline_contact_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_actor := COALESCE(NEW.moved_by, auth.uid());
    INSERT INTO public.pipeline_contact_events
      (pipeline_id, contact_id, brand_id, event_type, to_stage_id, actor_id)
    VALUES
      (NEW.pipeline_id, NEW.contact_id, NEW.brand_id, 'added', NEW.stage_id, v_actor);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    v_actor := COALESCE(NEW.moved_by, auth.uid());
    IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
      INSERT INTO public.pipeline_contact_events
        (pipeline_id, contact_id, brand_id, event_type, from_stage_id, to_stage_id, actor_id)
      VALUES
        (NEW.pipeline_id, NEW.contact_id, NEW.brand_id, 'moved', OLD.stage_id, NEW.stage_id, v_actor);
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.pipeline_contact_events
        (pipeline_id, contact_id, brand_id, event_type, to_stage_id, actor_id)
      VALUES
        (NEW.pipeline_id, NEW.contact_id, NEW.brand_id,
         CASE
           WHEN NEW.status = 'resolvido' THEN 'resolved'
           WHEN NEW.status = 'perdido' THEN 'lost'
           ELSE 'reopened'
         END,
         NEW.stage_id, v_actor);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    v_actor := COALESCE(OLD.moved_by, auth.uid());
    INSERT INTO public.pipeline_contact_events
      (pipeline_id, contact_id, brand_id, event_type, from_stage_id, actor_id)
    VALUES
      (OLD.pipeline_id, OLD.contact_id, OLD.brand_id, 'removed', OLD.stage_id, v_actor);
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

-- 6) Cancela atividades pendentes também quando cartão é marcado como 'perdido'
CREATE OR REPLACE FUNCTION public.tg_pipeline_contact_activities_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
          kind, mode, name, message_text, template_id, template_variables, due_at
        ) VALUES (
          NEW.id, NEW.pipeline_id, NEW.stage_id, NEW.contact_id, NEW.brand_id, v_def.id,
          v_def.kind, v_def.mode, v_def.name, v_def.message_text, v_def.template_id, v_def.template_variables,
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
            kind, mode, name, message_text, template_id, template_variables, due_at
          ) VALUES (
            NEW.id, NEW.pipeline_id, NEW.stage_id, NEW.contact_id, NEW.brand_id, v_def.id,
            v_def.kind, v_def.mode, v_def.name, v_def.message_text, v_def.template_id, v_def.template_variables,
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
END $$;