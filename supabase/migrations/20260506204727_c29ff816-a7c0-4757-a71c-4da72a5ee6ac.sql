
ALTER TABLE public.whatsapp_templates
  ADD COLUMN IF NOT EXISTS header_media_url text,
  ADD COLUMN IF NOT EXISTS header_media_mime text,
  ADD COLUMN IF NOT EXISTS header_media_filename text;
