CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE INDEX IF NOT EXISTS idx_contacts_brand_name_trgm
  ON public.contacts USING GIN (brand_id, name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_contacts_brand_profile_name_trgm
  ON public.contacts USING GIN (brand_id, profile_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_contacts_brand_phone_trgm
  ON public.contacts USING GIN (brand_id, phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_contacts_brand_wa_id_trgm
  ON public.contacts USING GIN (brand_id, wa_id gin_trgm_ops);

DROP INDEX IF EXISTS public.idx_contacts_name_trgm;
DROP INDEX IF EXISTS public.idx_contacts_profile_name_trgm;
DROP INDEX IF EXISTS public.idx_contacts_phone_trgm;
DROP INDEX IF EXISTS public.idx_contacts_wa_id_trgm;