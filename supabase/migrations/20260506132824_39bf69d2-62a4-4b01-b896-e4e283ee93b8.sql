
-- 1) brand_channels
CREATE TABLE public.brand_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  type team_type NOT NULL,
  phone_number text,
  phone_number_id text UNIQUE,
  waba_id text,
  business_id text,
  token_valid boolean NOT NULL DEFAULT false,
  token_last_validated_at timestamptz,
  token_last_error text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_brand_channels_brand ON public.brand_channels(brand_id);

ALTER TABLE public.brand_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_channels_admin_all ON public.brand_channels
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY brand_channels_select_member ON public.brand_channels
  FOR SELECT TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));

CREATE TRIGGER trg_brand_channels_updated
  BEFORE UPDATE ON public.brand_channels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) channel_secrets
CREATE TABLE public.channel_secrets (
  channel_id uuid PRIMARY KEY REFERENCES public.brand_channels(id) ON DELETE CASCADE,
  system_user_token text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.channel_secrets ENABLE ROW LEVEL SECURITY;
-- (sem políticas; somente service role)

-- 3) channel_id columns
ALTER TABLE public.teams ADD COLUMN channel_id uuid REFERENCES public.brand_channels(id) ON DELETE SET NULL;
ALTER TABLE public.conversations ADD COLUMN channel_id uuid REFERENCES public.brand_channels(id) ON DELETE SET NULL;
ALTER TABLE public.messages ADD COLUMN channel_id uuid REFERENCES public.brand_channels(id) ON DELETE SET NULL;
ALTER TABLE public.whatsapp_templates ADD COLUMN channel_id uuid REFERENCES public.brand_channels(id) ON DELETE CASCADE;

-- 4) Stop auto-create teams trigger
DROP TRIGGER IF EXISTS trg_brand_create_teams ON public.brands;

-- 5) Backfill: 1 canal por marca que já tem phone_number_id
DO $$
DECLARE
  b record;
  new_channel_id uuid;
  tok text;
BEGIN
  FOR b IN SELECT id, name, phone_number, phone_number_id, waba_id, business_id, token_valid, token_last_validated_at, token_last_error
           FROM public.brands LOOP
    IF b.phone_number_id IS NOT NULL THEN
      INSERT INTO public.brand_channels (brand_id, name, type, phone_number, phone_number_id, waba_id, business_id, token_valid, token_last_validated_at, token_last_error)
      VALUES (b.id, b.name, 'suporte', b.phone_number, b.phone_number_id, b.waba_id, b.business_id, COALESCE(b.token_valid,false), b.token_last_validated_at, b.token_last_error)
      RETURNING id INTO new_channel_id;
    ELSE
      INSERT INTO public.brand_channels (brand_id, name, type)
      VALUES (b.id, b.name, 'suporte')
      RETURNING id INTO new_channel_id;
    END IF;

    -- Move token (se existir)
    SELECT system_user_token INTO tok FROM public.brand_secrets WHERE brand_id = b.id;
    IF tok IS NOT NULL THEN
      INSERT INTO public.channel_secrets (channel_id, system_user_token) VALUES (new_channel_id, tok);
    END IF;

    -- Vincula teams/conversations/messages/templates ao canal
    UPDATE public.teams SET channel_id = new_channel_id WHERE brand_id = b.id AND channel_id IS NULL;
    UPDATE public.conversations SET channel_id = new_channel_id WHERE brand_id = b.id AND channel_id IS NULL;
    UPDATE public.messages SET channel_id = new_channel_id WHERE brand_id = b.id AND channel_id IS NULL;
    UPDATE public.whatsapp_templates SET channel_id = new_channel_id WHERE brand_id = b.id AND channel_id IS NULL;
  END LOOP;
END $$;

-- 6) Drop old columns from brands
ALTER TABLE public.brands
  DROP COLUMN phone_number,
  DROP COLUMN phone_number_id,
  DROP COLUMN waba_id,
  DROP COLUMN business_id,
  DROP COLUMN token_valid,
  DROP COLUMN token_last_validated_at,
  DROP COLUMN token_last_error;

DROP TABLE public.brand_secrets;

-- 7) Replace function create_default_brand_teams (now creates 1 team per channel)
DROP FUNCTION IF EXISTS public.create_default_brand_teams() CASCADE;

CREATE OR REPLACE FUNCTION public.create_default_channel_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  brand_name text;
BEGIN
  SELECT name INTO brand_name FROM public.brands WHERE id = NEW.brand_id;
  -- cria team do mesmo type para o canal, se ainda não houver
  IF NOT EXISTS (SELECT 1 FROM public.teams WHERE channel_id = NEW.id) THEN
    INSERT INTO public.teams (brand_id, channel_id, type, name)
    VALUES (NEW.brand_id, NEW.id, NEW.type,
            COALESCE(brand_name, 'Marca') || ' – ' || initcap(NEW.type::text) || ' (' || NEW.name || ')');
  END IF;
  RETURN NEW;
END $function$;

CREATE TRIGGER trg_channel_create_team
  AFTER INSERT ON public.brand_channels
  FOR EACH ROW EXECUTE FUNCTION public.create_default_channel_team();
