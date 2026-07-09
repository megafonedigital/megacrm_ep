
-- =========================================================
-- Fase 1 — Ellie AI engine: tabelas e colunas
-- =========================================================

-- ---------- Colunas novas em ai_agents (todas opcionais) ----------
ALTER TABLE public.ai_agents
  ADD COLUMN IF NOT EXISTS group_inputs_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS followup_minutes integer,
  ADD COLUMN IF NOT EXISTS default_user_message text,
  ADD COLUMN IF NOT EXISTS image_mode text NOT NULL DEFAULT 'ignore',
  ADD COLUMN IF NOT EXISTS audio_mode text NOT NULL DEFAULT 'ignore',
  ADD COLUMN IF NOT EXISTS dynamic_quick_replies boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ellie_context_window integer,
  ADD COLUMN IF NOT EXISTS buyer_validation_api_url text,
  ADD COLUMN IF NOT EXISTS buyer_validation_api_key_ref text,
  ADD COLUMN IF NOT EXISTS quick_replies jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ---------- ai_agent_functions ----------
CREATE TABLE IF NOT EXISTS public.ai_agent_functions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  action_type text NOT NULL DEFAULT 'custom',
  parameters_schema jsonb NOT NULL DEFAULT '{"type":"object","properties":{}}'::jsonb,
  target_automation_id uuid REFERENCES public.automations(id) ON DELETE SET NULL,
  save_results boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_agent_functions TO authenticated;
GRANT ALL ON public.ai_agent_functions TO service_role;
ALTER TABLE public.ai_agent_functions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_agent_functions_admin_all" ON public.ai_agent_functions
  TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY "ai_agent_functions_select_member" ON public.ai_agent_functions FOR SELECT
  TO authenticated USING (has_brand_access(auth.uid(), brand_id));
CREATE POLICY "ai_agent_functions_write_supervisor" ON public.ai_agent_functions
  TO authenticated
  USING (has_brand_access(auth.uid(), brand_id) AND (has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role)))
  WITH CHECK (has_brand_access(auth.uid(), brand_id) AND (has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role)));
CREATE INDEX IF NOT EXISTS idx_ai_agent_functions_agent ON public.ai_agent_functions(agent_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_functions_brand ON public.ai_agent_functions(brand_id);
CREATE TRIGGER trg_ai_agent_functions_updated_at BEFORE UPDATE ON public.ai_agent_functions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- ai_agent_function_runs ----------
CREATE TABLE IF NOT EXISTS public.ai_agent_function_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_id uuid REFERENCES public.ai_agent_functions(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.ai_agent_runs(id) ON DELETE SET NULL,
  thread_id uuid,
  name text NOT NULL,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  status text NOT NULL DEFAULT 'ok',
  error text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ai_agent_function_runs TO authenticated;
GRANT ALL ON public.ai_agent_function_runs TO service_role;
ALTER TABLE public.ai_agent_function_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_agent_function_runs_select_member" ON public.ai_agent_function_runs FOR SELECT
  TO authenticated USING (has_brand_access(auth.uid(), brand_id));
CREATE INDEX IF NOT EXISTS idx_ai_agent_function_runs_agent ON public.ai_agent_function_runs(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_agent_function_runs_run ON public.ai_agent_function_runs(run_id);

-- ---------- ai_agent_threads ----------
CREATE TABLE IF NOT EXISTS public.ai_agent_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  contact_email text,
  contact_phone text,
  is_buyer boolean NOT NULL DEFAULT false,
  buyer_validated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_agent_threads TO authenticated;
GRANT ALL ON public.ai_agent_threads TO service_role;
ALTER TABLE public.ai_agent_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_agent_threads_admin_all" ON public.ai_agent_threads
  TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY "ai_agent_threads_select_member" ON public.ai_agent_threads FOR SELECT
  TO authenticated USING (has_brand_access(auth.uid(), brand_id));
CREATE INDEX IF NOT EXISTS idx_ai_agent_threads_agent_contact ON public.ai_agent_threads(agent_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_threads_email ON public.ai_agent_threads(agent_id, lower(contact_email));
CREATE TRIGGER trg_ai_agent_threads_updated_at BEFORE UPDATE ON public.ai_agent_threads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- ai_agent_thread_messages ----------
CREATE TABLE IF NOT EXISTS public.ai_agent_thread_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.ai_agent_threads(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text,
  media_type text,
  media_url text,
  tool_calls jsonb,
  tool_call_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_agent_thread_messages TO authenticated;
GRANT ALL ON public.ai_agent_thread_messages TO service_role;
ALTER TABLE public.ai_agent_thread_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_agent_thread_messages_select_member" ON public.ai_agent_thread_messages FOR SELECT
  TO authenticated USING (has_brand_access(auth.uid(), brand_id));
CREATE INDEX IF NOT EXISTS idx_ai_agent_thread_messages_thread ON public.ai_agent_thread_messages(thread_id, created_at);

-- ---------- ai_agent_voice_configs ----------
CREATE TABLE IF NOT EXISTS public.ai_agent_voice_configs (
  agent_id uuid PRIMARY KEY REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'elevenlabs',
  voice_id text,
  model_id text NOT NULL DEFAULT 'eleven_multilingual_v2',
  stability numeric NOT NULL DEFAULT 0.5,
  similarity_boost numeric NOT NULL DEFAULT 0.75,
  style numeric NOT NULL DEFAULT 0,
  speed numeric NOT NULL DEFAULT 1.0,
  send_mode text NOT NULL DEFAULT 'text',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_agent_voice_configs TO authenticated;
GRANT ALL ON public.ai_agent_voice_configs TO service_role;
ALTER TABLE public.ai_agent_voice_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_agent_voice_configs_admin_all" ON public.ai_agent_voice_configs
  TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY "ai_agent_voice_configs_select_member" ON public.ai_agent_voice_configs FOR SELECT
  TO authenticated USING (has_brand_access(auth.uid(), brand_id));
CREATE POLICY "ai_agent_voice_configs_write_supervisor" ON public.ai_agent_voice_configs
  TO authenticated
  USING (has_brand_access(auth.uid(), brand_id) AND (has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role)))
  WITH CHECK (has_brand_access(auth.uid(), brand_id) AND (has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role)));
CREATE TRIGGER trg_ai_agent_voice_configs_updated_at BEFORE UPDATE ON public.ai_agent_voice_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- ellie_buyer_validations ----------
CREATE TABLE IF NOT EXISTS public.ellie_buyer_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  email text NOT NULL,
  phone text,
  full_name text,
  product text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ellie_buyer_validations_brand_email_uniq
  ON public.ellie_buyer_validations(brand_id, lower(email));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ellie_buyer_validations TO authenticated;
GRANT ALL ON public.ellie_buyer_validations TO service_role;
ALTER TABLE public.ellie_buyer_validations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ellie_buyer_validations_admin_all" ON public.ellie_buyer_validations
  TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY "ellie_buyer_validations_select_member" ON public.ellie_buyer_validations FOR SELECT
  TO authenticated USING (has_brand_access(auth.uid(), brand_id));
CREATE POLICY "ellie_buyer_validations_write_supervisor" ON public.ellie_buyer_validations
  TO authenticated
  USING (has_brand_access(auth.uid(), brand_id) AND (has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role)))
  WITH CHECK (has_brand_access(auth.uid(), brand_id) AND (has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'developer'::app_role)));
CREATE TRIGGER trg_ellie_buyer_validations_updated_at BEFORE UPDATE ON public.ellie_buyer_validations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
