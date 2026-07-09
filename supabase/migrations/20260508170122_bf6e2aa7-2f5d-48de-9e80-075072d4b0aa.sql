CREATE TABLE public.api_request_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  brand_id uuid,
  api_key_id uuid,
  api_key_prefix text,
  method text NOT NULL,
  path text NOT NULL,
  status_code integer NOT NULL,
  duration_ms integer,
  ip text,
  user_agent text,
  request_body jsonb,
  response_summary jsonb
);

CREATE INDEX idx_api_request_logs_brand_created ON public.api_request_logs (brand_id, created_at DESC);
CREATE INDEX idx_api_request_logs_key_created ON public.api_request_logs (api_key_id, created_at DESC);
CREATE INDEX idx_api_request_logs_created ON public.api_request_logs (created_at DESC);

ALTER TABLE public.api_request_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_request_logs_admin_all"
  ON public.api_request_logs FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "api_request_logs_supervisor_select"
  ON public.api_request_logs FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'supervisor'::app_role)
    AND (brand_id IS NULL OR public.has_brand_access(auth.uid(), brand_id))
  );