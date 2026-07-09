-- Tabela singleton-style de configurações globais da aplicação.
-- Usada inicialmente pela feature flag do fast-path de broadcasts.
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Leitura aberta para qualquer usuário autenticado (flags públicas de UI).
-- Escrita somente via service_role (server functions / edge functions).
CREATE POLICY "app_settings readable by authenticated"
  ON public.app_settings
  FOR SELECT
  TO authenticated
  USING (true);

-- Seed da flag desligada por padrão.
INSERT INTO public.app_settings (key, value)
VALUES ('broadcasts.fast_path_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;