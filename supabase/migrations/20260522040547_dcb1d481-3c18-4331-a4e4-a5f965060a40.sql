
-- ============= Tipos =============
CREATE TYPE public.ai_agent_status AS ENUM ('off', 'test', 'on');
CREATE TYPE public.ai_knowledge_product_source AS ENUM ('hotmart', 'shopify', 'manual');

-- ============= ai_agents =============
CREATE TABLE public.ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL,
  name text NOT NULL,
  status public.ai_agent_status NOT NULL DEFAULT 'off',
  whitelist jsonb NOT NULL DEFAULT '[]'::jsonb,
  system_prompt text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  temperature numeric NOT NULL DEFAULT 0.7,
  max_output_tokens integer NOT NULL DEFAULT 1024,
  response_delay_ms integer NOT NULL DEFAULT 8000,
  context_window_messages integer NOT NULL DEFAULT 20,
  escalation_target_suporte uuid,
  escalation_target_vendas uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_agents_brand ON public.ai_agents(brand_id);
ALTER TABLE public.ai_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_agents_admin_all ON public.ai_agents
  FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY ai_agents_select_member ON public.ai_agents
  FOR SELECT TO authenticated
  USING (has_brand_access(auth.uid(), brand_id));
CREATE POLICY ai_agents_write_supervisor ON public.ai_agents
  FOR ALL TO authenticated
  USING (has_brand_access(auth.uid(), brand_id)
    AND (has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role)))
  WITH CHECK (has_brand_access(auth.uid(), brand_id)
    AND (has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role)));

CREATE TRIGGER trg_ai_agents_updated_at BEFORE UPDATE ON public.ai_agents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============= ai_knowledge_products =============
CREATE TABLE public.ai_knowledge_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  source public.ai_knowledge_product_source NOT NULL DEFAULT 'manual',
  external_product_id text,
  product_name text NOT NULL,
  sku text,
  utm_default text,
  faq jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_kb_products_agent ON public.ai_knowledge_products(agent_id);
ALTER TABLE public.ai_knowledge_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_kb_products_admin_all ON public.ai_knowledge_products
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY ai_kb_products_select_member ON public.ai_knowledge_products
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_agents a WHERE a.id = agent_id AND has_brand_access(auth.uid(), a.brand_id)));
CREATE POLICY ai_kb_products_write_supervisor ON public.ai_knowledge_products
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_agents a WHERE a.id = agent_id AND has_brand_access(auth.uid(), a.brand_id)
    AND (has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ai_agents a WHERE a.id = agent_id AND has_brand_access(auth.uid(), a.brand_id)
    AND (has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role))));

CREATE TRIGGER trg_ai_kb_products_updated_at BEFORE UPDATE ON public.ai_knowledge_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============= ai_knowledge_context =============
CREATE TABLE public.ai_knowledge_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_kb_context_agent ON public.ai_knowledge_context(agent_id);
ALTER TABLE public.ai_knowledge_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_kb_context_admin_all ON public.ai_knowledge_context
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY ai_kb_context_select_member ON public.ai_knowledge_context
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_agents a WHERE a.id = agent_id AND has_brand_access(auth.uid(), a.brand_id)));
CREATE POLICY ai_kb_context_write_supervisor ON public.ai_knowledge_context
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_agents a WHERE a.id = agent_id AND has_brand_access(auth.uid(), a.brand_id)
    AND (has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ai_agents a WHERE a.id = agent_id AND has_brand_access(auth.uid(), a.brand_id)
    AND (has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role))));

CREATE OR REPLACE FUNCTION public.validate_ai_kb_context()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.ends_at <= NEW.starts_at THEN
    RAISE EXCEPTION 'A data de fim deve ser maior que a data de início';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_validate_ai_kb_context BEFORE INSERT OR UPDATE ON public.ai_knowledge_context
  FOR EACH ROW EXECUTE FUNCTION public.validate_ai_kb_context();
CREATE TRIGGER trg_ai_kb_context_updated_at BEFORE UPDATE ON public.ai_knowledge_context
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============= ai_knowledge_company =============
CREATE TABLE public.ai_knowledge_company (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL UNIQUE REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_knowledge_company ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_kb_company_admin_all ON public.ai_knowledge_company
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY ai_kb_company_select_member ON public.ai_knowledge_company
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_agents a WHERE a.id = agent_id AND has_brand_access(auth.uid(), a.brand_id)));
CREATE POLICY ai_kb_company_write_supervisor ON public.ai_knowledge_company
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_agents a WHERE a.id = agent_id AND has_brand_access(auth.uid(), a.brand_id)
    AND (has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ai_agents a WHERE a.id = agent_id AND has_brand_access(auth.uid(), a.brand_id)
    AND (has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role))));

CREATE TRIGGER trg_ai_kb_company_updated_at BEFORE UPDATE ON public.ai_knowledge_company
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============= ai_agent_channel_assignments =============
CREATE TABLE public.ai_agent_channel_assignments (
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL,
  weight integer NOT NULL DEFAULT 1 CHECK (weight >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, channel_id)
);
CREATE INDEX idx_ai_aca_channel ON public.ai_agent_channel_assignments(channel_id);
ALTER TABLE public.ai_agent_channel_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_aca_admin_all ON public.ai_agent_channel_assignments
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY ai_aca_select_member ON public.ai_agent_channel_assignments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.brand_channels bc WHERE bc.id = channel_id AND has_brand_access(auth.uid(), bc.brand_id)));
CREATE POLICY ai_aca_write_supervisor ON public.ai_agent_channel_assignments
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.brand_channels bc WHERE bc.id = channel_id AND has_brand_access(auth.uid(), bc.brand_id)
    AND (has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.brand_channels bc WHERE bc.id = channel_id AND has_brand_access(auth.uid(), bc.brand_id)
    AND (has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role))));

-- ============= ai_agent_pending_runs =============
CREATE TABLE public.ai_agent_pending_runs (
  conversation_id uuid PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  run_after timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_pending_runs_run_after ON public.ai_agent_pending_runs(run_after);
ALTER TABLE public.ai_agent_pending_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_pending_runs_admin ON public.ai_agent_pending_runs
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- ============= conversations.ai_agent_id =============
ALTER TABLE public.conversations ADD COLUMN ai_agent_id uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL;
CREATE INDEX idx_conversations_ai_agent ON public.conversations(ai_agent_id) WHERE ai_agent_id IS NOT NULL;

-- ============= pick_next_assignee (humanos + IA) =============
CREATE OR REPLACE FUNCTION public.pick_next_assignee(_channel_id uuid)
RETURNS TABLE(kind text, id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _total_human integer := 0;
  _total_ai integer := 0;
  _total integer := 0;
  _r integer;
  _ai_id uuid;
BEGIN
  -- soma pesos humanos
  SELECT COALESCE(SUM(ca.weight), 0) INTO _total_human
    FROM public.channel_agents ca
    JOIN public.profiles p ON p.id = ca.user_id AND p.active = true
    WHERE ca.channel_id = _channel_id AND ca.weight > 0;

  -- soma pesos IA (apenas agentes ativos: status test/on)
  SELECT COALESCE(SUM(aca.weight), 0) INTO _total_ai
    FROM public.ai_agent_channel_assignments aca
    JOIN public.ai_agents a ON a.id = aca.agent_id
    WHERE aca.channel_id = _channel_id AND aca.weight > 0
      AND a.status IN ('test','on');

  _total := _total_human + _total_ai;
  IF _total = 0 THEN
    RETURN;
  END IF;

  -- sorteio ponderado simples (random). Humanos mantém SWRR via pick_next_agent.
  _r := floor(random() * _total)::int;

  IF _r < _total_human THEN
    -- delega para função existente para preservar SWRR entre humanos
    kind := 'human';
    id := public.pick_next_agent(_channel_id);
    IF id IS NULL THEN RETURN; END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  -- escolhe IA ponderado
  SELECT aca.agent_id INTO _ai_id
    FROM public.ai_agent_channel_assignments aca
    JOIN public.ai_agents a ON a.id = aca.agent_id
    WHERE aca.channel_id = _channel_id AND aca.weight > 0
      AND a.status IN ('test','on')
    ORDER BY random() * aca.weight DESC
    LIMIT 1;

  IF _ai_id IS NULL THEN RETURN; END IF;
  kind := 'ai';
  id := _ai_id;
  RETURN NEXT;
END $$;
