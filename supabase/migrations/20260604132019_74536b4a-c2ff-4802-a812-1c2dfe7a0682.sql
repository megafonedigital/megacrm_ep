CREATE INDEX IF NOT EXISTS idx_conversations_brand_assigned_last
  ON public.conversations (brand_id, assigned_to, last_message_at DESC NULLS LAST)
  WHERE last_message_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_brand_unassigned_last
  ON public.conversations (brand_id, last_message_at DESC NULLS LAST)
  WHERE assigned_to IS NULL AND last_message_at IS NOT NULL;