
-- Long-term per-contact memory for AI agents
CREATE TABLE IF NOT EXISTS public.ai_agent_contact_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('identity','preference','pain','goal','restriction','history','other')),
  confidence numeric NOT NULL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),
  source_message_id uuid NULL,
  last_mentioned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, contact_id, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_agent_contact_memory TO authenticated;
GRANT ALL ON public.ai_agent_contact_memory TO service_role;

ALTER TABLE public.ai_agent_contact_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "memory_brand_select" ON public.ai_agent_contact_memory
  FOR SELECT TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));

CREATE POLICY "memory_brand_modify" ON public.ai_agent_contact_memory
  FOR ALL TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id))
  WITH CHECK (public.has_brand_access(auth.uid(), brand_id));

CREATE INDEX IF NOT EXISTS idx_memory_agent_contact_updated
  ON public.ai_agent_contact_memory (agent_id, contact_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_brand_contact
  ON public.ai_agent_contact_memory (brand_id, contact_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_ai_agent_contact_memory()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_ai_agent_contact_memory
  BEFORE UPDATE ON public.ai_agent_contact_memory
  FOR EACH ROW EXECUTE FUNCTION public.touch_ai_agent_contact_memory();

-- Pruning trigger: keep <= 80 keys per (agent_id, contact_id).
-- Deletes the lowest-confidence, oldest entries on overflow.
CREATE OR REPLACE FUNCTION public.prune_ai_agent_contact_memory()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_count integer;
  v_excess integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.ai_agent_contact_memory
  WHERE agent_id = NEW.agent_id AND contact_id = NEW.contact_id;

  v_excess := v_count - 80;
  IF v_excess > 0 THEN
    DELETE FROM public.ai_agent_contact_memory
    WHERE id IN (
      SELECT id FROM public.ai_agent_contact_memory
      WHERE agent_id = NEW.agent_id AND contact_id = NEW.contact_id
      ORDER BY confidence ASC, last_mentioned_at ASC
      LIMIT v_excess
    );
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_prune_ai_agent_contact_memory
  AFTER INSERT ON public.ai_agent_contact_memory
  FOR EACH ROW EXECUTE FUNCTION public.prune_ai_agent_contact_memory();

-- Long-term memory feature flag on the agent.
ALTER TABLE public.ai_agents
  ADD COLUMN IF NOT EXISTS long_term_memory_enabled boolean NOT NULL DEFAULT false;
