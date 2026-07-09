ALTER TABLE public.brand_channels
  ADD COLUMN IF NOT EXISTS use_global_webhook boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_brand_channels_use_global_webhook
  ON public.brand_channels (use_global_webhook)
  WHERE use_global_webhook = true;

UPDATE public.brand_channels
   SET use_global_webhook = true
 WHERE brand_id IN (
   'b4453b54-73b6-4b07-92ff-2f0b8a6f8b99',
   'c9e506de-44d3-4646-9cb8-15760503a6a6'
 );