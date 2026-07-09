
CREATE TABLE public.automation_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL,
  name text NOT NULL,
  color text,
  position integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_automation_folders_brand ON public.automation_folders(brand_id);

ALTER TABLE public.automations ADD COLUMN folder_id uuid;
CREATE INDEX idx_automations_brand_folder ON public.automations(brand_id, folder_id);

ALTER TABLE public.automation_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "automation_folders_admin_all" ON public.automation_folders
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "automation_folders_select_member" ON public.automation_folders
  FOR SELECT TO authenticated
  USING (has_brand_access(auth.uid(), brand_id));

CREATE POLICY "automation_folders_supervisor_all" ON public.automation_folders
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'supervisor'::app_role) AND has_brand_access(auth.uid(), brand_id))
  WITH CHECK (has_role(auth.uid(), 'supervisor'::app_role) AND has_brand_access(auth.uid(), brand_id));

CREATE POLICY "automation_folders_developer_all" ON public.automation_folders
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'developer'::app_role) AND has_brand_access(auth.uid(), brand_id))
  WITH CHECK (has_role(auth.uid(), 'developer'::app_role) AND has_brand_access(auth.uid(), brand_id));

CREATE TRIGGER automation_folders_set_updated_at
  BEFORE UPDATE ON public.automation_folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
