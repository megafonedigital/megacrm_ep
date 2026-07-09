
-- Tabela de pricing por modelo (usado para custo no dashboard)
CREATE TABLE IF NOT EXISTS public.ai_model_pricing (
  model text PRIMARY KEY,
  input_per_1k numeric NOT NULL DEFAULT 0,
  output_per_1k numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_model_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_model_pricing_read_auth" ON public.ai_model_pricing
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "ai_model_pricing_admin_all" ON public.ai_model_pricing
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Seed dos modelos suportados (preços aproximados em USD por 1K tokens)
INSERT INTO public.ai_model_pricing (model, input_per_1k, output_per_1k) VALUES
  ('google/gemini-3-flash-preview', 0.00010, 0.00040),
  ('google/gemini-2.5-flash', 0.00010, 0.00040),
  ('google/gemini-2.5-flash-lite', 0.00005, 0.00020),
  ('google/gemini-2.5-pro', 0.00125, 0.00500),
  ('openai/gpt-5', 0.00500, 0.01500),
  ('openai/gpt-5-mini', 0.00050, 0.00200),
  ('openai/gpt-5-nano', 0.00010, 0.00040)
ON CONFLICT (model) DO NOTHING;

-- Tabela de revisões de escalação (feedback loop)
CREATE TABLE IF NOT EXISTS public.ai_escalation_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.ai_agent_runs(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  original_reason text,
  validated_reason text,
  was_correct boolean NOT NULL,
  reviewer_id uuid,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_escalation_reviews_run_unique ON public.ai_escalation_reviews(run_id);
CREATE INDEX IF NOT EXISTS ai_escalation_reviews_agent_idx ON public.ai_escalation_reviews(agent_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS ai_escalation_reviews_brand_idx ON public.ai_escalation_reviews(brand_id, reviewed_at DESC);

ALTER TABLE public.ai_escalation_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_escalation_reviews_admin_all" ON public.ai_escalation_reviews
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "ai_escalation_reviews_select_member" ON public.ai_escalation_reviews
  FOR SELECT TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));

CREATE POLICY "ai_escalation_reviews_insert_member" ON public.ai_escalation_reviews
  FOR INSERT TO authenticated
  WITH CHECK (public.has_brand_access(auth.uid(), brand_id) AND reviewer_id = auth.uid());

CREATE POLICY "ai_escalation_reviews_update_owner" ON public.ai_escalation_reviews
  FOR UPDATE TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id) AND (reviewer_id = auth.uid() OR public.has_role(auth.uid(), 'supervisor'::app_role)))
  WITH CHECK (public.has_brand_access(auth.uid(), brand_id));
