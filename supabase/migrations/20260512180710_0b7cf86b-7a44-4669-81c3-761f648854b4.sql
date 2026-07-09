CREATE INDEX IF NOT EXISTS idx_integration_events_contact_created
  ON public.integration_events(contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;