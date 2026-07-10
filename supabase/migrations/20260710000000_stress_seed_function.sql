-- Seed de stress test: gera contatos fake + tag __stress-test-10k na marca.
-- Idempotente: reexecutar só completa o que falta (conflitos são ignorados).
-- Admin-only; números usam prefixo 5500 (DDD inválido no BR — nunca reais).
CREATE OR REPLACE FUNCTION public.seed_stress_contacts(_brand_id uuid, _count integer DEFAULT 10000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tag_id uuid;
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
    ON CONFLICT (brand_id, wa_id) DO NOTHING
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

  RETURN jsonb_build_object('tag_id', v_tag_id, 'created', v_created, 'tagged', v_tagged);
END
$function$;

REVOKE ALL ON FUNCTION public.seed_stress_contacts(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_stress_contacts(uuid, integer) TO authenticated;
