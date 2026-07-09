ALTER TABLE public.ai_knowledge_products
  ADD COLUMN IF NOT EXISTS utm_params jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.ai_knowledge_products
   SET utm_params = jsonb_build_object('campaign', utm_default)
 WHERE utm_default IS NOT NULL
   AND utm_default <> ''
   AND (utm_params = '{}'::jsonb OR utm_params IS NULL);