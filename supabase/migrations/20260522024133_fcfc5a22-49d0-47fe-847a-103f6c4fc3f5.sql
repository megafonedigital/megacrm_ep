ALTER TABLE public.pipeline_contacts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'aberto'
  CHECK (status IN ('aberto','resolvido'));

CREATE INDEX IF NOT EXISTS pipeline_contacts_status_idx
  ON public.pipeline_contacts (pipeline_id, status);