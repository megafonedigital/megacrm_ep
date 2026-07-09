
ALTER TABLE public.brand_channels ADD COLUMN IF NOT EXISTS app_id text;
ALTER TABLE public.whatsapp_templates ADD COLUMN IF NOT EXISTS header_type text;
ALTER TABLE public.whatsapp_templates ADD COLUMN IF NOT EXISTS header_handle text;
