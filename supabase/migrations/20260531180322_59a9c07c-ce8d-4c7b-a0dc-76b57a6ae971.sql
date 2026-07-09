CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_contacts_search_name_trgm
  ON public.contacts USING gin (name gin_trgm_ops)
  WHERE name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_search_profile_name_trgm
  ON public.contacts USING gin (profile_name gin_trgm_ops)
  WHERE profile_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_search_phone_trgm
  ON public.contacts USING gin (phone gin_trgm_ops)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_search_wa_id_trgm
  ON public.contacts USING gin (wa_id gin_trgm_ops)
  WHERE wa_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_search_email_trgm
  ON public.contacts USING gin ((metadata->>'email') gin_trgm_ops)
  WHERE metadata ? 'email';