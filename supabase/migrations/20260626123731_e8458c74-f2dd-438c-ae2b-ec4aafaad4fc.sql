CREATE INDEX IF NOT EXISTS idx_conversations_contact_brand_assigned
  ON public.conversations (contact_id, brand_id, assigned_to);