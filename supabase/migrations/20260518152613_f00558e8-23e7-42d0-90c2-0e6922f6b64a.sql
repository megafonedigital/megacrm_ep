-- Tag folders
CREATE TABLE public.tag_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL,
  name text NOT NULL,
  color text,
  position integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tag_folders_brand ON public.tag_folders(brand_id, position);

ALTER TABLE public.tag_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tag_folders_admin_all ON public.tag_folders FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY tag_folders_select_member ON public.tag_folders FOR SELECT TO authenticated
  USING (has_brand_access(auth.uid(), brand_id));
CREATE POLICY tag_folders_write_member ON public.tag_folders FOR ALL TO authenticated
  USING (has_brand_access(auth.uid(), brand_id) AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role)))
  WITH CHECK (has_brand_access(auth.uid(), brand_id) AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role)));

CREATE TRIGGER set_tag_folders_updated_at BEFORE UPDATE ON public.tag_folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Tags catalog
CREATE TABLE public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL,
  folder_id uuid REFERENCES public.tag_folders(id) ON DELETE SET NULL,
  name text NOT NULL,
  color text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, name)
);
CREATE INDEX idx_tags_brand_folder ON public.tags(brand_id, folder_id);

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY tags_admin_all ON public.tags FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY tags_select_member ON public.tags FOR SELECT TO authenticated
  USING (has_brand_access(auth.uid(), brand_id));
CREATE POLICY tags_write_member ON public.tags FOR ALL TO authenticated
  USING (has_brand_access(auth.uid(), brand_id))
  WITH CHECK (has_brand_access(auth.uid(), brand_id));

CREATE TRIGGER set_tags_updated_at BEFORE UPDATE ON public.tags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Contact <-> Tag (N:N)
CREATE TABLE public.contact_tags (
  contact_id uuid NOT NULL,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, tag_id)
);
CREATE INDEX idx_contact_tags_tag ON public.contact_tags(tag_id);
CREATE INDEX idx_contact_tags_contact ON public.contact_tags(contact_id);

ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY contact_tags_admin_all ON public.contact_tags FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY contact_tags_select_member ON public.contact_tags FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_id AND has_brand_access(auth.uid(), c.brand_id)));
CREATE POLICY contact_tags_write_member ON public.contact_tags FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_id AND has_brand_access(auth.uid(), c.brand_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_id AND has_brand_access(auth.uid(), c.brand_id)));

-- Custom fields
CREATE TABLE public.custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL,
  key text NOT NULL,
  label text NOT NULL,
  type text NOT NULL DEFAULT 'text', -- text, number, date, boolean, select
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  position integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, key)
);
CREATE INDEX idx_custom_fields_brand ON public.custom_fields(brand_id, position);

ALTER TABLE public.custom_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY custom_fields_admin_all ON public.custom_fields FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY custom_fields_select_member ON public.custom_fields FOR SELECT TO authenticated
  USING (has_brand_access(auth.uid(), brand_id));
CREATE POLICY custom_fields_write_member ON public.custom_fields FOR ALL TO authenticated
  USING (has_brand_access(auth.uid(), brand_id) AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role)))
  WITH CHECK (has_brand_access(auth.uid(), brand_id) AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role)));

CREATE TRIGGER set_custom_fields_updated_at BEFORE UPDATE ON public.custom_fields
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Migrate existing metadata.tags into catalog + contact_tags
DO $$
DECLARE
  c RECORD;
  t text;
  tag_row_id uuid;
BEGIN
  FOR c IN
    SELECT id, brand_id, metadata FROM public.contacts
    WHERE metadata ? 'tags' AND jsonb_typeof(metadata->'tags') = 'array'
  LOOP
    FOR t IN SELECT jsonb_array_elements_text(c.metadata->'tags')
    LOOP
      IF t IS NULL OR length(trim(t)) = 0 THEN CONTINUE; END IF;
      INSERT INTO public.tags (brand_id, name)
        VALUES (c.brand_id, trim(t))
        ON CONFLICT (brand_id, name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO tag_row_id;
      INSERT INTO public.contact_tags (contact_id, tag_id)
        VALUES (c.id, tag_row_id)
        ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- Sync triggers: keep contacts.metadata.tags in sync with contact_tags
CREATE OR REPLACE FUNCTION public.sync_contact_tags_to_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _contact_id uuid;
  _names text[];
  _meta jsonb;
BEGIN
  _contact_id := COALESCE(NEW.contact_id, OLD.contact_id);
  SELECT COALESCE(array_agg(t.name ORDER BY t.name), ARRAY[]::text[])
    INTO _names
    FROM public.contact_tags ct
    JOIN public.tags t ON t.id = ct.tag_id
    WHERE ct.contact_id = _contact_id;
  SELECT COALESCE(metadata, '{}'::jsonb) INTO _meta FROM public.contacts WHERE id = _contact_id;
  UPDATE public.contacts
    SET metadata = jsonb_set(_meta, '{tags}', to_jsonb(_names), true)
    WHERE id = _contact_id;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_contact_tags_sync_ins AFTER INSERT ON public.contact_tags
  FOR EACH ROW EXECUTE FUNCTION public.sync_contact_tags_to_metadata();
CREATE TRIGGER trg_contact_tags_sync_del AFTER DELETE ON public.contact_tags
  FOR EACH ROW EXECUTE FUNCTION public.sync_contact_tags_to_metadata();