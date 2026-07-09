
CREATE TABLE IF NOT EXISTS public.wa_send_media_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  phone_number_id text NOT NULL,
  source_url text NOT NULL,
  source_hash text NOT NULL,
  media_id text NOT NULL,
  mime_type text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS wa_send_media_cache_unique_idx
  ON public.wa_send_media_cache (brand_id, phone_number_id, source_hash);

CREATE INDEX IF NOT EXISTS wa_send_media_cache_expires_idx
  ON public.wa_send_media_cache (expires_at);

GRANT ALL ON public.wa_send_media_cache TO service_role;

ALTER TABLE public.wa_send_media_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role manages media cache"
  ON public.wa_send_media_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
