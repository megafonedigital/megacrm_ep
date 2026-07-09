ALTER TABLE public.brand_channels
  ADD COLUMN IF NOT EXISTS webhook_verify_token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS brand_channels_webhook_verify_token_uidx
  ON public.brand_channels (webhook_verify_token);