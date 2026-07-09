CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_contacts_name_trgm
  ON public.contacts USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_contacts_profile_name_trgm
  ON public.contacts USING GIN (profile_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_contacts_phone_trgm
  ON public.contacts USING GIN (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_contacts_wa_id_trgm
  ON public.contacts USING GIN (wa_id gin_trgm_ops);