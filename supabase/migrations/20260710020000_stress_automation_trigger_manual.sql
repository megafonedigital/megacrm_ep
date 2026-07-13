-- A automação do stress test precisa de trigger_type='manual' — o wizard de
-- broadcast só lista automações manuais. O default da coluna é 'tag', e o
-- seed anterior não setava o valor.

-- 1) Corrige automações de stress já criadas
UPDATE public.automations
   SET trigger_type = 'manual'
 WHERE name = 'Stress Test — tag add/remove'
   AND trigger_type <> 'manual';

-- 2) Seed passa a criar com trigger_type='manual'
CREATE OR REPLACE FUNCTION public.seed_stress_contacts(_brand_id uuid, _count integer DEFAULT 10000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tag_id uuid;
  v_automation_id uuid;
  v_created integer;
  v_tagged integer;
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas administradores podem gerar contatos de stress test'
      USING ERRCODE = '42501';
  END IF;
  IF _count < 1 OR _count > 50000 THEN
    RAISE EXCEPTION 'count fora do intervalo permitido (1-50000)';
  END IF;

  INSERT INTO public.tags (brand_id, name, color, created_by)
  VALUES (_brand_id, '__stress-test-10k', '#8b5cf6', auth.uid())
  ON CONFLICT (brand_id, name) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_tag_id;

  WITH ins AS (
    INSERT INTO public.contacts (brand_id, wa_id, phone, name, profile_name, metadata)
    SELECT _brand_id,
           '5500' || lpad(n::text, 9, '0'),
           '+5500' || lpad(n::text, 9, '0'),
           'Stress Fake ' || n,
           'Stress Fake ' || n,
           jsonb_build_object('stress_test', true)
      FROM generate_series(1, _count) AS n
    ON CONFLICT (brand_id, wa_id) WHERE wa_id IS NOT NULL DO NOTHING
    RETURNING id
  )
  SELECT count(*)::int INTO v_created FROM ins;

  WITH tag_ins AS (
    INSERT INTO public.contact_tags (contact_id, tag_id)
    SELECT c.id, v_tag_id
      FROM public.contacts c
     WHERE c.brand_id = _brand_id
       AND c.metadata @> '{"stress_test": true}'::jsonb
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_tagged FROM tag_ins;

  SELECT id INTO v_automation_id
    FROM public.automations
   WHERE brand_id = _brand_id AND name = 'Stress Test — tag add/remove'
   LIMIT 1;

  IF v_automation_id IS NULL THEN
    INSERT INTO public.automations (brand_id, name, description, status, trigger_type, graph, created_by)
    VALUES (
      _brand_id,
      'Stress Test — tag add/remove',
      'Gerada pelo seed de stress test. Só aplica e remove uma tag interna — sem WhatsApp.',
      'active',
      'manual',
      '{
        "nodes": [
          {"id":"trigger-1","type":"trigger","position":{"x":400,"y":40},"data":{"triggerType":"manual"}},
          {"id":"tag-add","type":"add_tag","position":{"x":400,"y":200},"data":{"tags":["stress-run"],"op":"add"}},
          {"id":"tag-remove","type":"add_tag","position":{"x":400,"y":360},"data":{"tags":["stress-run"],"op":"remove"}}
        ],
        "edges": [
          {"id":"e-trig-add","source":"trigger-1","target":"tag-add","type":"deletable","animated":true},
          {"id":"e-add-remove","source":"tag-add","target":"tag-remove","type":"deletable","animated":true}
        ]
      }'::jsonb,
      auth.uid()
    )
    RETURNING id INTO v_automation_id;
  END IF;

  RETURN jsonb_build_object(
    'tag_id', v_tag_id,
    'automation_id', v_automation_id,
    'created', v_created,
    'tagged', v_tagged
  );
END
$function$;
