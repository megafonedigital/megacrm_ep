-- Onda 1: campos aditivos para BSUID/username em contacts
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS bsuid text,
  ADD COLUMN IF NOT EXISTS username text;

-- Índice único parcial por workspace quando bsuid estiver presente
CREATE UNIQUE INDEX IF NOT EXISTS contacts_brand_bsuid_unique
  ON public.contacts (brand_id, bsuid)
  WHERE bsuid IS NOT NULL;

-- Índice para lookup rápido por username (não único — usernames podem repetir entre contatos distintos)
CREATE INDEX IF NOT EXISTS contacts_brand_username_idx
  ON public.contacts (brand_id, username)
  WHERE username IS NOT NULL;

-- Feature flag por workspace controlando o modo BSUID
-- off    = ignora BSUIDs (comportamento atual)
-- shadow = grava BSUID quando recebido, mas continua usando wa_id/phone para envio
-- on     = usa BSUID para envio quando disponível (Onda 2)
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS bsuid_mode text NOT NULL DEFAULT 'off';

-- Validação do valor da flag via trigger (CHECK constraints são frágeis para evoluir)
CREATE OR REPLACE FUNCTION public.validate_brand_bsuid_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.bsuid_mode NOT IN ('off', 'shadow', 'on') THEN
    RAISE EXCEPTION 'bsuid_mode inválido: %, esperado off | shadow | on', NEW.bsuid_mode;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_brand_bsuid_mode_trigger ON public.brands;
CREATE TRIGGER validate_brand_bsuid_mode_trigger
  BEFORE INSERT OR UPDATE OF bsuid_mode ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.validate_brand_bsuid_mode();

COMMENT ON COLUMN public.contacts.bsuid IS 'Meta Business-Scoped User ID (preparação WA 2026). Independente de wa_id/phone.';
COMMENT ON COLUMN public.contacts.username IS 'WhatsApp username opcional (display only).';
COMMENT ON COLUMN public.brands.bsuid_mode IS 'Modo BSUID por workspace: off (ignora), shadow (grava só), on (usa para envio).';