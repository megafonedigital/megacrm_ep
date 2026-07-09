CREATE INDEX IF NOT EXISTS idx_automation_runs_brand_started
  ON public.automation_runs (brand_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_request_logs_brand_created
  ON public.api_request_logs (brand_id, created_at DESC);