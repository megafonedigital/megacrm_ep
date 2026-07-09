
CREATE TABLE public.contact_imports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id UUID NOT NULL,
  created_by UUID,
  filename TEXT,
  total_rows INTEGER NOT NULL DEFAULT 0,
  processed_rows INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  tag_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  update_existing BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contact_imports_status_chk CHECK (status IN ('queued','running','completed','failed','cancelled'))
);
CREATE INDEX idx_contact_imports_brand_created ON public.contact_imports (brand_id, created_at DESC);
CREATE INDEX idx_contact_imports_status ON public.contact_imports (status) WHERE status IN ('queued','running');

GRANT SELECT, INSERT, UPDATE ON public.contact_imports TO authenticated;
GRANT ALL ON public.contact_imports TO service_role;
ALTER TABLE public.contact_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY contact_imports_select_member ON public.contact_imports
  FOR SELECT TO authenticated USING (has_brand_access(auth.uid(), brand_id));
CREATE POLICY contact_imports_insert_member ON public.contact_imports
  FOR INSERT TO authenticated WITH CHECK (has_brand_access(auth.uid(), brand_id) AND created_by = auth.uid());
CREATE POLICY contact_imports_update_member ON public.contact_imports
  FOR UPDATE TO authenticated USING (has_brand_access(auth.uid(), brand_id)) WITH CHECK (has_brand_access(auth.uid(), brand_id));
CREATE POLICY contact_imports_admin_all ON public.contact_imports
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

CREATE TABLE public.contact_import_batches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  import_id UUID NOT NULL REFERENCES public.contact_imports(id) ON DELETE CASCADE,
  batch_index INTEGER NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contact_import_batches_status_chk CHECK (status IN ('pending','processing','done','failed')),
  CONSTRAINT contact_import_batches_unique UNIQUE (import_id, batch_index)
);
CREATE INDEX idx_contact_import_batches_pending ON public.contact_import_batches (import_id, batch_index) WHERE status = 'pending';

GRANT SELECT ON public.contact_import_batches TO authenticated;
GRANT ALL ON public.contact_import_batches TO service_role;
ALTER TABLE public.contact_import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY contact_import_batches_select_member ON public.contact_import_batches
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.contact_imports ci
    WHERE ci.id = contact_import_batches.import_id AND has_brand_access(auth.uid(), ci.brand_id)
  ));
CREATE POLICY contact_import_batches_admin_all ON public.contact_import_batches
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

CREATE TABLE public.contact_import_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  import_id UUID NOT NULL REFERENCES public.contact_imports(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  row_index INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contact_import_logs_level_chk CHECK (level IN ('info','warn','error'))
);
CREATE INDEX idx_contact_import_logs_import_created ON public.contact_import_logs (import_id, created_at DESC);

GRANT SELECT ON public.contact_import_logs TO authenticated;
GRANT ALL ON public.contact_import_logs TO service_role;
ALTER TABLE public.contact_import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY contact_import_logs_select_member ON public.contact_import_logs
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.contact_imports ci
    WHERE ci.id = contact_import_logs.import_id AND has_brand_access(auth.uid(), ci.brand_id)
  ));
CREATE POLICY contact_import_logs_admin_all ON public.contact_import_logs
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.claim_next_import_batch(_import_id UUID)
RETURNS TABLE(id UUID, import_id UUID, batch_index INTEGER, payload JSONB, attempts INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  SELECT b.id INTO v_id FROM public.contact_import_batches b
  WHERE b.import_id = _import_id AND b.status = 'pending'
  ORDER BY b.batch_index FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;
  UPDATE public.contact_import_batches SET status='processing', attempts=attempts+1 WHERE contact_import_batches.id=v_id;
  RETURN QUERY SELECT b.id, b.import_id, b.batch_index, b.payload, b.attempts
    FROM public.contact_import_batches b WHERE b.id=v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.claim_next_pending_import()
RETURNS TABLE(id UUID, brand_id UUID, tag_ids UUID[], update_existing BOOLEAN, created_by UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  SELECT ci.id INTO v_id FROM public.contact_imports ci
  WHERE ci.status IN ('queued','running')
    AND EXISTS (SELECT 1 FROM public.contact_import_batches b WHERE b.import_id=ci.id AND b.status='pending')
  ORDER BY ci.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;
  UPDATE public.contact_imports SET status='running', started_at=COALESCE(started_at, now()) WHERE contact_imports.id=v_id;
  RETURN QUERY SELECT ci.id, ci.brand_id, ci.tag_ids, ci.update_existing, ci.created_by
    FROM public.contact_imports ci WHERE ci.id=v_id;
END; $$;

CREATE TRIGGER trg_contact_imports_set_updated_at
BEFORE UPDATE ON public.contact_imports
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.contact_imports;
ALTER PUBLICATION supabase_realtime ADD TABLE public.contact_import_logs;
