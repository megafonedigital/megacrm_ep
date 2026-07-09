ALTER TABLE public.automations DROP CONSTRAINT automations_trigger_type_check;
ALTER TABLE public.automations ADD CONSTRAINT automations_trigger_type_check
  CHECK (trigger_type = ANY (ARRAY['tag','manual','activecampaign','shopify','hotmart','sendflow']));