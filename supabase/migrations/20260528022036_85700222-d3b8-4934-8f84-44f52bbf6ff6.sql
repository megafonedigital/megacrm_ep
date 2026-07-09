ALTER TABLE public.whatsapp_templates
  DROP CONSTRAINT IF EXISTS whatsapp_templates_brand_id_name_language_key;

ALTER TABLE public.whatsapp_templates
  ADD CONSTRAINT whatsapp_templates_channel_id_name_language_key
  UNIQUE (channel_id, name, language);