ALTER TABLE public.integration_global_limits DROP CONSTRAINT integration_global_limits_global_rate_limit_per_minute_check;
ALTER TABLE public.integration_global_limits ADD CONSTRAINT integration_global_limits_global_rate_limit_per_minute_check CHECK (global_rate_limit_per_minute >= 30 AND global_rate_limit_per_minute <= 20000);

ALTER TABLE public.integration_global_limits DROP CONSTRAINT integration_global_limits_global_burst_check;
ALTER TABLE public.integration_global_limits ADD CONSTRAINT integration_global_limits_global_burst_check CHECK (global_burst >= 10 AND global_burst <= 5000);

ALTER TABLE public.integration_global_limits DROP CONSTRAINT integration_global_limits_tier_check;
ALTER TABLE public.integration_global_limits ADD CONSTRAINT integration_global_limits_tier_check CHECK (tier = ANY (ARRAY['conservador','equilibrado','alto','intenso','turbo','maximo','custom']::text[]));