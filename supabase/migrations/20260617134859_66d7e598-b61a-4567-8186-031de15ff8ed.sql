
CREATE TABLE public.copilot_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  thread_id uuid REFERENCES public.copilot_threads(id) ON DELETE SET NULL,
  tool text NOT NULL,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  ok boolean NOT NULL DEFAULT true,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_copilot_audit_log_brand_created ON public.copilot_audit_log (brand_id, created_at DESC);
CREATE INDEX idx_copilot_audit_log_user ON public.copilot_audit_log (user_id, created_at DESC);

GRANT SELECT ON public.copilot_audit_log TO authenticated;
GRANT ALL ON public.copilot_audit_log TO service_role;

ALTER TABLE public.copilot_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Copilot audit log visible to admins/supervisors/devs of brand"
ON public.copilot_audit_log
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'supervisor')
  OR public.has_role(auth.uid(), 'developer')
);
