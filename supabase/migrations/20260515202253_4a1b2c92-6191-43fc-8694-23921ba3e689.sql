ALTER TABLE public.whatsapp_templates
  ADD COLUMN IF NOT EXISTS variable_bindings jsonb NOT NULL DEFAULT '[]'::jsonb;