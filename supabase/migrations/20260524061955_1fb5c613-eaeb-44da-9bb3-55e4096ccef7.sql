ALTER TABLE public.ai_knowledge_company
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS expert_name text;