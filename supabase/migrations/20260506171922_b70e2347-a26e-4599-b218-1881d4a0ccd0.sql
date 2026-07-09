ALTER TABLE public.brand_channels
  ADD COLUMN IF NOT EXISTS templates_last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS templates_last_error text,
  ADD COLUMN IF NOT EXISTS last_webhook_at timestamptz;