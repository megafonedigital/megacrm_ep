ALTER TABLE public.api_request_logs
  ADD CONSTRAINT api_request_logs_brand_id_fkey
  FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE SET NULL;

ALTER TABLE public.api_request_logs
  ADD CONSTRAINT api_request_logs_api_key_id_fkey
  FOREIGN KEY (api_key_id) REFERENCES public.brand_api_keys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_api_request_logs_brand_id ON public.api_request_logs(brand_id);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_created_at ON public.api_request_logs(created_at DESC);