-- 1) Add columns
ALTER TABLE public.ai_knowledge_company
  ADD COLUMN IF NOT EXISTS brand_id uuid,
  ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Documento principal';

ALTER TABLE public.ai_knowledge_context
  ADD COLUMN IF NOT EXISTS brand_id uuid;

ALTER TABLE public.ai_knowledge_products
  ADD COLUMN IF NOT EXISTS brand_id uuid,
  ADD COLUMN IF NOT EXISTS integration_product_id uuid;

-- 2) Backfill brand_id from agent
UPDATE public.ai_knowledge_company k SET brand_id = a.brand_id
  FROM public.ai_agents a WHERE k.brand_id IS NULL AND k.agent_id = a.id;
UPDATE public.ai_knowledge_context k SET brand_id = a.brand_id
  FROM public.ai_agents a WHERE k.brand_id IS NULL AND k.agent_id = a.id;
UPDATE public.ai_knowledge_products k SET brand_id = a.brand_id
  FROM public.ai_agents a WHERE k.brand_id IS NULL AND k.agent_id = a.id;

DELETE FROM public.ai_knowledge_company  WHERE brand_id IS NULL;
DELETE FROM public.ai_knowledge_context  WHERE brand_id IS NULL;
DELETE FROM public.ai_knowledge_products WHERE brand_id IS NULL;

ALTER TABLE public.ai_knowledge_company  ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE public.ai_knowledge_context  ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE public.ai_knowledge_products ALTER COLUMN brand_id SET NOT NULL;

-- 3) Drop old policies that reference agent_id
DROP POLICY IF EXISTS ai_kb_company_admin_all          ON public.ai_knowledge_company;
DROP POLICY IF EXISTS ai_kb_company_select_member      ON public.ai_knowledge_company;
DROP POLICY IF EXISTS ai_kb_company_write_supervisor   ON public.ai_knowledge_company;
DROP POLICY IF EXISTS ai_kb_context_admin_all          ON public.ai_knowledge_context;
DROP POLICY IF EXISTS ai_kb_context_select_member      ON public.ai_knowledge_context;
DROP POLICY IF EXISTS ai_kb_context_write_supervisor   ON public.ai_knowledge_context;
DROP POLICY IF EXISTS ai_kb_products_admin_all         ON public.ai_knowledge_products;
DROP POLICY IF EXISTS ai_kb_products_select_member     ON public.ai_knowledge_products;
DROP POLICY IF EXISTS ai_kb_products_write_supervisor  ON public.ai_knowledge_products;

-- 4) Drop legacy unique on ai_knowledge_company (one-per-agent)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.ai_knowledge_company'::regclass
       AND contype IN ('u')
  LOOP
    EXECUTE format('ALTER TABLE public.ai_knowledge_company DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- 5) Create N:N link table
CREATE TABLE IF NOT EXISTS public.ai_agent_knowledge (
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('company','context','product')),
  kb_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, kind, kb_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_knowledge_kb ON public.ai_agent_knowledge(kind, kb_id);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_company_brand ON public.ai_knowledge_company(brand_id);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_context_brand ON public.ai_knowledge_context(brand_id);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_products_brand ON public.ai_knowledge_products(brand_id);

-- 6) Backfill ai_agent_knowledge from current agent_id columns
INSERT INTO public.ai_agent_knowledge (agent_id, kind, kb_id)
  SELECT agent_id, 'company', id FROM public.ai_knowledge_company  WHERE agent_id IS NOT NULL
  ON CONFLICT DO NOTHING;
INSERT INTO public.ai_agent_knowledge (agent_id, kind, kb_id)
  SELECT agent_id, 'context', id FROM public.ai_knowledge_context  WHERE agent_id IS NOT NULL
  ON CONFLICT DO NOTHING;
INSERT INTO public.ai_agent_knowledge (agent_id, kind, kb_id)
  SELECT agent_id, 'product', id FROM public.ai_knowledge_products WHERE agent_id IS NOT NULL
  ON CONFLICT DO NOTHING;

-- 7) Drop agent_id from bases (policies that depended on it were dropped above)
ALTER TABLE public.ai_knowledge_company  DROP COLUMN IF EXISTS agent_id;
ALTER TABLE public.ai_knowledge_context  DROP COLUMN IF EXISTS agent_id;
ALTER TABLE public.ai_knowledge_products DROP COLUMN IF EXISTS agent_id;

-- 8) New RLS based on brand_id
CREATE POLICY ai_kb_company_admin_all ON public.ai_knowledge_company
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY ai_kb_company_select_member ON public.ai_knowledge_company
  FOR SELECT TO authenticated USING (has_brand_access(auth.uid(), brand_id));
CREATE POLICY ai_kb_company_write_supervisor ON public.ai_knowledge_company
  FOR ALL TO authenticated
  USING (has_brand_access(auth.uid(), brand_id) AND (has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'developer'::app_role)))
  WITH CHECK (has_brand_access(auth.uid(), brand_id) AND (has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'developer'::app_role)));

CREATE POLICY ai_kb_context_admin_all ON public.ai_knowledge_context
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY ai_kb_context_select_member ON public.ai_knowledge_context
  FOR SELECT TO authenticated USING (has_brand_access(auth.uid(), brand_id));
CREATE POLICY ai_kb_context_write_supervisor ON public.ai_knowledge_context
  FOR ALL TO authenticated
  USING (has_brand_access(auth.uid(), brand_id) AND (has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'developer'::app_role)))
  WITH CHECK (has_brand_access(auth.uid(), brand_id) AND (has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'developer'::app_role)));

CREATE POLICY ai_kb_products_admin_all ON public.ai_knowledge_products
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY ai_kb_products_select_member ON public.ai_knowledge_products
  FOR SELECT TO authenticated USING (has_brand_access(auth.uid(), brand_id));
CREATE POLICY ai_kb_products_write_supervisor ON public.ai_knowledge_products
  FOR ALL TO authenticated
  USING (has_brand_access(auth.uid(), brand_id) AND (has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'developer'::app_role)))
  WITH CHECK (has_brand_access(auth.uid(), brand_id) AND (has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'developer'::app_role)));

-- 9) RLS on link table
ALTER TABLE public.ai_agent_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_agent_knowledge_admin_all ON public.ai_agent_knowledge
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY ai_agent_knowledge_select_member ON public.ai_agent_knowledge
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_agents a WHERE a.id = ai_agent_knowledge.agent_id AND has_brand_access(auth.uid(), a.brand_id)));
CREATE POLICY ai_agent_knowledge_write_supervisor ON public.ai_agent_knowledge
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_agents a WHERE a.id = ai_agent_knowledge.agent_id AND has_brand_access(auth.uid(), a.brand_id) AND (has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'developer'::app_role))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ai_agents a WHERE a.id = ai_agent_knowledge.agent_id AND has_brand_access(auth.uid(), a.brand_id) AND (has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'developer'::app_role))));