-- 1) Backfill _automation_id e _brand_id em runs vivos
UPDATE public.automation_runs r
SET variables = COALESCE(r.variables, '{}'::jsonb)
  || jsonb_build_object('_automation_id', r.automation_id::text)
  || jsonb_build_object(
       '_brand_id',
       (SELECT a.brand_id::text FROM public.automations a WHERE a.id = r.automation_id)
     )
WHERE r.status IN ('running','waiting','waiting_button')
  AND (
    (r.variables->>'_automation_id') IS NULL
    OR (r.variables->>'_brand_id') IS NULL
  );

-- 2) Zerar runs de teste do Afonso
WITH afonso_runs AS (
  SELECT r.id
  FROM public.automation_runs r
  WHERE r.conversation_id = '39b92006-237f-43cb-bc61-6a2d985092d3'
     OR r.variables->>'contact_id' IN (
       SELECT id::text FROM public.contacts WHERE profile_name ILIKE '%afonso%damasceno%'
     )
)
DELETE FROM public.automation_scheduled_steps WHERE run_id IN (SELECT id FROM afonso_runs);

WITH afonso_runs AS (
  SELECT r.id
  FROM public.automation_runs r
  WHERE r.conversation_id = '39b92006-237f-43cb-bc61-6a2d985092d3'
     OR r.variables->>'contact_id' IN (
       SELECT id::text FROM public.contacts WHERE profile_name ILIKE '%afonso%damasceno%'
     )
)
DELETE FROM public.automation_node_messages WHERE run_id IN (SELECT id FROM afonso_runs);

WITH afonso_runs AS (
  SELECT r.id
  FROM public.automation_runs r
  WHERE r.conversation_id = '39b92006-237f-43cb-bc61-6a2d985092d3'
     OR r.variables->>'contact_id' IN (
       SELECT id::text FROM public.contacts WHERE profile_name ILIKE '%afonso%damasceno%'
     )
)
DELETE FROM public.automation_run_steps WHERE run_id IN (SELECT id FROM afonso_runs);

DELETE FROM public.automation_runs r
WHERE r.conversation_id = '39b92006-237f-43cb-bc61-6a2d985092d3'
   OR r.variables->>'contact_id' IN (
     SELECT id::text FROM public.contacts WHERE profile_name ILIKE '%afonso%damasceno%'
   );