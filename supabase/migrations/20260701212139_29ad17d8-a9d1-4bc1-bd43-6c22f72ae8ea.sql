
CREATE TABLE public.brand_media_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  url text NOT NULL,
  mime text NOT NULL,
  kind text NOT NULL,
  filename text,
  size_bytes bigint,
  source text NOT NULL DEFAULT 'automation',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_brand_media_library_brand_kind_created
  ON public.brand_media_library (brand_id, kind, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_media_library TO authenticated;
GRANT ALL ON public.brand_media_library TO service_role;

ALTER TABLE public.brand_media_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_media_library_admin_all ON public.brand_media_library
  FOR ALL USING (is_admin(auth.uid()));

CREATE POLICY brand_media_library_developer_all ON public.brand_media_library
  FOR ALL USING (has_role(auth.uid(), 'developer'::app_role) AND has_brand_access(auth.uid(), brand_id));

CREATE POLICY brand_media_library_select_member ON public.brand_media_library
  FOR SELECT USING (has_brand_access(auth.uid(), brand_id));

CREATE POLICY brand_media_library_insert_member ON public.brand_media_library
  FOR INSERT WITH CHECK (has_brand_access(auth.uid(), brand_id));

CREATE POLICY brand_media_library_delete_member ON public.brand_media_library
  FOR DELETE USING (has_brand_access(auth.uid(), brand_id));
