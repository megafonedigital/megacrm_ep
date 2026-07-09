SET statement_timeout = '5min';

DROP INDEX IF EXISTS public.idx_api_request_logs_path_created_at;

CREATE INDEX IF NOT EXISTS idx_api_request_logs_path_created_at ON public.api_request_logs (path text_pattern_ops, created_at DESC);