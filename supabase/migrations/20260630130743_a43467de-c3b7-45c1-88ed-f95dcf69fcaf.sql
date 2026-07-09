
-- 1) Colunas em ai_agents
ALTER TABLE public.ai_agents
  ADD COLUMN IF NOT EXISTS lead_free_message_limit integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS lead_mode_prompt text,
  ADD COLUMN IF NOT EXISTS lead_offer_prompt text;

-- 2) Catálogo de ofertas (modo lead esgotado)
CREATE TABLE IF NOT EXISTS public.ellie_lead_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  checkout_url text,
  image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ellie_lead_offers_agent ON public.ellie_lead_offers(agent_id);
CREATE INDEX IF NOT EXISTS idx_ellie_lead_offers_brand ON public.ellie_lead_offers(brand_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ellie_lead_offers TO authenticated;
GRANT ALL ON public.ellie_lead_offers TO service_role;

ALTER TABLE public.ellie_lead_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "offers select by brand access" ON public.ellie_lead_offers
  FOR SELECT TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));
CREATE POLICY "offers insert by brand access" ON public.ellie_lead_offers
  FOR INSERT TO authenticated
  WITH CHECK (public.has_brand_access(auth.uid(), brand_id));
CREATE POLICY "offers update by brand access" ON public.ellie_lead_offers
  FOR UPDATE TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id))
  WITH CHECK (public.has_brand_access(auth.uid(), brand_id));
CREATE POLICY "offers delete by brand access" ON public.ellie_lead_offers
  FOR DELETE TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_ellie_lead_offers_updated ON public.ellie_lead_offers;
CREATE TRIGGER trg_ellie_lead_offers_updated
  BEFORE UPDATE ON public.ellie_lead_offers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Contador de uso por contato/agent
CREATE TABLE IF NOT EXISTS public.ellie_lead_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  messages_used integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_ellie_lead_usage_brand ON public.ellie_lead_usage(brand_id);
CREATE INDEX IF NOT EXISTS idx_ellie_lead_usage_contact ON public.ellie_lead_usage(contact_id);

GRANT SELECT, UPDATE ON public.ellie_lead_usage TO authenticated;
GRANT ALL ON public.ellie_lead_usage TO service_role;

ALTER TABLE public.ellie_lead_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage select by brand access" ON public.ellie_lead_usage
  FOR SELECT TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));
CREATE POLICY "usage update by brand access" ON public.ellie_lead_usage
  FOR UPDATE TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id))
  WITH CHECK (public.has_brand_access(auth.uid(), brand_id));

DROP TRIGGER IF EXISTS trg_ellie_lead_usage_updated ON public.ellie_lead_usage;
CREATE TRIGGER trg_ellie_lead_usage_updated
  BEFORE UPDATE ON public.ellie_lead_usage
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) RPC atômico de incremento
CREATE OR REPLACE FUNCTION public.increment_ellie_lead_usage(
  _agent_id uuid, _brand_id uuid, _contact_id uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new integer;
BEGIN
  INSERT INTO public.ellie_lead_usage (agent_id, brand_id, contact_id, messages_used, last_message_at)
  VALUES (_agent_id, _brand_id, _contact_id, 1, now())
  ON CONFLICT (agent_id, contact_id)
  DO UPDATE SET messages_used = public.ellie_lead_usage.messages_used + 1,
                last_message_at = now()
  RETURNING messages_used INTO v_new;
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_ellie_lead_usage(uuid, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_ellie_lead_usage(uuid, uuid, uuid) TO service_role;

-- 5) RPC reset (para o painel humano)
CREATE OR REPLACE FUNCTION public.reset_ellie_lead_usage(
  _agent_id uuid, _contact_id uuid
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.ellie_lead_usage
  SET messages_used = 0, updated_at = now()
  WHERE agent_id = _agent_id AND contact_id = _contact_id;
$$;

GRANT EXECUTE ON FUNCTION public.reset_ellie_lead_usage(uuid, uuid) TO authenticated, service_role;
