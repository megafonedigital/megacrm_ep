
-- pipelines
CREATE TABLE public.pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  position integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pipelines_brand ON public.pipelines(brand_id, position);
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;

CREATE POLICY pipelines_select ON public.pipelines
  FOR SELECT TO authenticated
  USING (has_brand_access(auth.uid(), brand_id));

CREATE POLICY pipelines_write ON public.pipelines
  FOR ALL TO authenticated
  USING (has_brand_access(auth.uid(), brand_id) AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'supervisor'::app_role)))
  WITH CHECK (has_brand_access(auth.uid(), brand_id) AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'supervisor'::app_role)));

CREATE TRIGGER pipelines_set_updated_at BEFORE UPDATE ON public.pipelines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- pipeline_stages
CREATE TABLE public.pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pipeline_stages_pipeline ON public.pipeline_stages(pipeline_id, position);
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY pipeline_stages_select ON public.pipeline_stages
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id = pipeline_stages.pipeline_id AND has_brand_access(auth.uid(), p.brand_id)));

CREATE POLICY pipeline_stages_write ON public.pipeline_stages
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id = pipeline_stages.pipeline_id AND has_brand_access(auth.uid(), p.brand_id) AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'supervisor'::app_role))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id = pipeline_stages.pipeline_id AND has_brand_access(auth.uid(), p.brand_id) AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'supervisor'::app_role))));

CREATE TRIGGER pipeline_stages_set_updated_at BEFORE UPDATE ON public.pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- pipeline_contacts
CREATE TABLE public.pipeline_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  moved_by uuid,
  moved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_id, contact_id)
);
CREATE INDEX idx_pipeline_contacts_stage ON public.pipeline_contacts(pipeline_id, stage_id, position);
CREATE INDEX idx_pipeline_contacts_contact ON public.pipeline_contacts(contact_id);
ALTER TABLE public.pipeline_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY pipeline_contacts_select ON public.pipeline_contacts
  FOR SELECT TO authenticated
  USING (has_brand_access(auth.uid(), brand_id));

CREATE POLICY pipeline_contacts_write ON public.pipeline_contacts
  FOR ALL TO authenticated
  USING (has_brand_access(auth.uid(), brand_id))
  WITH CHECK (has_brand_access(auth.uid(), brand_id));

CREATE TRIGGER pipeline_contacts_set_updated_at BEFORE UPDATE ON public.pipeline_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
