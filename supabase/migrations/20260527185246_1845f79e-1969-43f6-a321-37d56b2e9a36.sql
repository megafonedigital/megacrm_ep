CREATE INDEX IF NOT EXISTS idx_contacts_brand_ac_id
  ON public.contacts (brand_id, (metadata->>'activecampaign_id'))
  WHERE metadata->>'activecampaign_id' IS NOT NULL;