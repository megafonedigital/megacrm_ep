ALTER TABLE public.brand_channels
  ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS registration_last_error TEXT NULL;