-- ===== pipeline_stage_activities =====
CREATE TABLE public.pipeline_stage_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  name text NOT NULL DEFAULT 'Atividade',
  kind text NOT NULL CHECK (kind IN ('send_message','send_template')),
  mode text NOT NULL DEFAULT 'manual' CHECK (mode IN ('auto','manual')),
  delay_minutes integer NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0),
  message_text text,
  template_id uuid REFERENCES public.whatsapp_templates(id) ON DELETE SET NULL,
  template_variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_psa_stage ON public.pipeline_stage_activities(stage_id, position);
CREATE INDEX idx_psa_pipeline ON public.pipeline_stage_activities(pipeline_id);

ALTER TABLE public.pipeline_stage_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY psa_select ON public.pipeline_stage_activities
  FOR SELECT TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));

CREATE POLICY psa_write ON public.pipeline_stage_activities
  FOR ALL TO authenticated
  USING (
    public.has_brand_access(auth.uid(), brand_id)
    AND (public.is_admin(auth.uid())
      OR public.has_role(auth.uid(),'supervisor'::app_role)
      OR public.has_role(auth.uid(),'developer'::app_role))
  )
  WITH CHECK (
    public.has_brand_access(auth.uid(), brand_id)
    AND (public.is_admin(auth.uid())
      OR public.has_role(auth.uid(),'supervisor'::app_role)
      OR public.has_role(auth.uid(),'developer'::app_role))
  );

CREATE TRIGGER trg_psa_updated_at BEFORE UPDATE ON public.pipeline_stage_activities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== pipeline_contact_activities =====
CREATE TABLE public.pipeline_contact_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_contact_id uuid NOT NULL REFERENCES public.pipeline_contacts(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  activity_id uuid REFERENCES public.pipeline_stage_activities(id) ON DELETE SET NULL,
  -- snapshot dos campos da definição (para sobreviver à edição/remoção)
  kind text NOT NULL CHECK (kind IN ('send_message','send_template')),
  mode text NOT NULL CHECK (mode IN ('auto','manual')),
  name text NOT NULL DEFAULT 'Atividade',
  message_text text,
  template_id uuid,
  template_variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','done','failed','cancelled','skipped')),
  cancel_reason text CHECK (cancel_reason IN ('stage_changed','resolved','manual') OR cancel_reason IS NULL),
  executed_at timestamptz,
  executed_by uuid,
  wa_message_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pca_pipeline_contact ON public.pipeline_contact_activities(pipeline_contact_id);
CREATE INDEX idx_pca_due ON public.pipeline_contact_activities(status, due_at) WHERE status='pending';
CREATE INDEX idx_pca_contact ON public.pipeline_contact_activities(contact_id);
CREATE INDEX idx_pca_brand ON public.pipeline_contact_activities(brand_id);

ALTER TABLE public.pipeline_contact_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY pca_select ON public.pipeline_contact_activities
  FOR SELECT TO authenticated
  USING (public.can_view_contact_assignment(auth.uid(), contact_id, brand_id));

CREATE POLICY pca_insert ON public.pipeline_contact_activities
  FOR INSERT TO authenticated
  WITH CHECK (public.has_brand_access(auth.uid(), brand_id));

CREATE POLICY pca_update ON public.pipeline_contact_activities
  FOR UPDATE TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id))
  WITH CHECK (public.has_brand_access(auth.uid(), brand_id));

CREATE TRIGGER trg_pca_updated_at BEFORE UPDATE ON public.pipeline_contact_activities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== Função de geração de instâncias para uma etapa =====
CREATE OR REPLACE FUNCTION public.tg_pipeline_contact_activities_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_def record;
  v_has_terminal boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- entrou na etapa: gera instâncias para definições ativas (sem terminal anterior)
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
    -- mudou de etapa: cancela pendentes da etapa anterior
    IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
      UPDATE public.pipeline_contact_activities
         SET status = 'cancelled', cancel_reason = 'stage_changed', updated_at = now()
       WHERE pipeline_contact_id = NEW.id
         AND stage_id = OLD.stage_id
         AND status = 'pending';

      -- e gera instâncias da nova etapa (regra: só não-terminal)
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

    -- resolveu: cancela todas pendentes do contato neste pipeline_contact
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'resolvido' THEN
      UPDATE public.pipeline_contact_activities
         SET status = 'cancelled', cancel_reason = 'resolved', updated_at = now()
       WHERE pipeline_contact_id = NEW.id AND status = 'pending';
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_pipeline_contacts_activities_lifecycle
AFTER INSERT OR UPDATE ON public.pipeline_contacts
FOR EACH ROW EXECUTE FUNCTION public.tg_pipeline_contact_activities_lifecycle();