
-- ============= pipeline_contact_events =============
CREATE TABLE public.pipeline_contact_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id   uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  brand_id      uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  event_type    text NOT NULL CHECK (event_type IN ('added','moved','resolved','reopened','removed')),
  from_stage_id uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id   uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  actor_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pce_contact ON public.pipeline_contact_events (contact_id, created_at DESC);
CREATE INDEX idx_pce_pipeline ON public.pipeline_contact_events (pipeline_id, created_at DESC);

ALTER TABLE public.pipeline_contact_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY pce_select ON public.pipeline_contact_events
  FOR SELECT TO authenticated
  USING (public.can_view_contact_assignment(auth.uid(), contact_id, brand_id));

CREATE POLICY pce_admin_all ON public.pipeline_contact_events
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Trigger function
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
         CASE WHEN NEW.status = 'resolvido' THEN 'resolved' ELSE 'reopened' END,
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

CREATE TRIGGER trg_pipeline_contacts_log
AFTER INSERT OR UPDATE OR DELETE ON public.pipeline_contacts
FOR EACH ROW EXECUTE FUNCTION public.tg_log_pipeline_contact_event();

-- Backfill: 1 "added" por linha existente
INSERT INTO public.pipeline_contact_events
  (pipeline_id, contact_id, brand_id, event_type, to_stage_id, actor_id, created_at)
SELECT pipeline_id, contact_id, brand_id, 'added', stage_id, moved_by,
       COALESCE(moved_at, created_at)
FROM public.pipeline_contacts;


-- ============= contact_tag_events =============
CREATE TABLE public.contact_tag_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  brand_id    uuid NOT NULL,
  tag_id      uuid,
  tag_name    text NOT NULL,
  event_type  text NOT NULL CHECK (event_type IN ('added','removed')),
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cte_contact ON public.contact_tag_events (contact_id, created_at DESC);

ALTER TABLE public.contact_tag_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY cte_select ON public.contact_tag_events
  FOR SELECT TO authenticated
  USING (public.can_view_contact_assignment(auth.uid(), contact_id, brand_id));

CREATE POLICY cte_admin_all ON public.contact_tag_events
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_log_contact_tag_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag record;
  v_brand uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT t.name, c.brand_id INTO v_tag
      FROM public.tags t, public.contacts c
      WHERE t.id = NEW.tag_id AND c.id = NEW.contact_id;
    IF v_tag IS NULL THEN RETURN NEW; END IF;
    INSERT INTO public.contact_tag_events
      (contact_id, brand_id, tag_id, tag_name, event_type, actor_id)
    VALUES
      (NEW.contact_id, v_tag.brand_id, NEW.tag_id, v_tag.name, 'added', auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT t.name AS name, c.brand_id AS brand_id INTO v_tag
      FROM public.tags t, public.contacts c
      WHERE t.id = OLD.tag_id AND c.id = OLD.contact_id;
    -- Fallback se contato/tag foi removido junto
    IF v_tag IS NULL THEN
      SELECT brand_id INTO v_brand FROM public.contacts WHERE id = OLD.contact_id;
      INSERT INTO public.contact_tag_events
        (contact_id, brand_id, tag_id, tag_name, event_type, actor_id)
      VALUES
        (OLD.contact_id, COALESCE(v_brand, '00000000-0000-0000-0000-000000000000'::uuid), OLD.tag_id, '(removida)', 'removed', auth.uid());
    ELSE
      INSERT INTO public.contact_tag_events
        (contact_id, brand_id, tag_id, tag_name, event_type, actor_id)
      VALUES
        (OLD.contact_id, v_tag.brand_id, OLD.tag_id, v_tag.name, 'removed', auth.uid());
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_contact_tags_log
AFTER INSERT OR DELETE ON public.contact_tags
FOR EACH ROW EXECUTE FUNCTION public.tg_log_contact_tag_event();
