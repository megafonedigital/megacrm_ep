CREATE TABLE public.pipeline_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_templates_brand ON public.pipeline_templates(brand_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_templates TO authenticated;
GRANT ALL ON public.pipeline_templates TO service_role;

ALTER TABLE public.pipeline_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipeline_templates_select"
  ON public.pipeline_templates FOR SELECT
  TO authenticated
  USING (has_brand_access(auth.uid(), brand_id));

CREATE POLICY "pipeline_templates_write"
  ON public.pipeline_templates FOR ALL
  TO authenticated
  USING (has_brand_access(auth.uid(), brand_id) AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'supervisor'::app_role)))
  WITH CHECK (has_brand_access(auth.uid(), brand_id) AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'supervisor'::app_role)));

CREATE POLICY "pipeline_templates_developer_write"
  ON public.pipeline_templates FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'developer'::app_role) AND has_brand_access(auth.uid(), brand_id))
  WITH CHECK (has_role(auth.uid(), 'developer'::app_role) AND has_brand_access(auth.uid(), brand_id));

CREATE TRIGGER update_pipeline_templates_updated_at
  BEFORE UPDATE ON public.pipeline_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();