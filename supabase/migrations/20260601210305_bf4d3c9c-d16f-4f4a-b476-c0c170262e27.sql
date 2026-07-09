-- Função: prévia do público de um broadcast (contagem + amostra)
CREATE OR REPLACE FUNCTION public.preview_broadcast_audience(
  _brand_id uuid,
  _include_tag_id uuid DEFAULT NULL,
  _exclude_tag_id uuid DEFAULT NULL,
  _sample_limit int DEFAULT 20
)
RETURNS TABLE(
  total_count bigint,
  sample jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_include_name text;
  v_exclude_name text;
  v_sample jsonb;
  v_total bigint;
BEGIN
  IF NOT public.has_brand_access(auth.uid(), _brand_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF _include_tag_id IS NOT NULL THEN
    SELECT name INTO v_include_name FROM public.tags WHERE id = _include_tag_id AND brand_id = _brand_id;
  END IF;
  IF _exclude_tag_id IS NOT NULL THEN
    SELECT name INTO v_exclude_name FROM public.tags WHERE id = _exclude_tag_id AND brand_id = _brand_id;
  END IF;

  WITH base AS (
    SELECT c.id, c.name, c.profile_name, c.phone, c.wa_id
    FROM public.contacts c
    WHERE c.brand_id = _brand_id
      AND (
        v_include_name IS NULL
        OR c.metadata->'tags' @> to_jsonb(ARRAY[v_include_name])
      )
      AND (
        v_exclude_name IS NULL
        OR NOT (c.metadata->'tags' @> to_jsonb(ARRAY[v_exclude_name]))
      )
  )
  SELECT
    (SELECT count(*) FROM base),
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name, 'profile_name', b.profile_name,
        'phone', b.phone, 'wa_id', b.wa_id
      ))
      FROM (SELECT * FROM base LIMIT greatest(coalesce(_sample_limit,20), 0)) b),
      '[]'::jsonb
    )
  INTO v_total, v_sample;

  total_count := v_total;
  sample := v_sample;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.preview_broadcast_audience(uuid, uuid, uuid, int) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_broadcast_audience(uuid, uuid, uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_broadcast_audience(uuid, uuid, uuid, int) TO service_role;


-- Função: cria os broadcast_targets em uma única passagem,
-- a partir do mesmo filtro usado na prévia.
CREATE OR REPLACE FUNCTION public.create_broadcast_targets_for_audience(
  _broadcast_id uuid,
  _brand_id uuid,
  _include_tag_id uuid DEFAULT NULL,
  _exclude_tag_id uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_include_name text;
  v_exclude_name text;
  v_inserted bigint;
BEGIN
  IF NOT public.has_brand_access(auth.uid(), _brand_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF _include_tag_id IS NOT NULL THEN
    SELECT name INTO v_include_name FROM public.tags WHERE id = _include_tag_id AND brand_id = _brand_id;
  END IF;
  IF _exclude_tag_id IS NOT NULL THEN
    SELECT name INTO v_exclude_name FROM public.tags WHERE id = _exclude_tag_id AND brand_id = _brand_id;
  END IF;

  WITH ins AS (
    INSERT INTO public.broadcast_targets (broadcast_id, contact_id)
    SELECT _broadcast_id, c.id
    FROM public.contacts c
    WHERE c.brand_id = _brand_id
      AND (
        v_include_name IS NULL
        OR c.metadata->'tags' @> to_jsonb(ARRAY[v_include_name])
      )
      AND (
        v_exclude_name IS NULL
        OR NOT (c.metadata->'tags' @> to_jsonb(ARRAY[v_exclude_name]))
      )
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  UPDATE public.broadcasts
     SET total_targets = v_inserted
   WHERE id = _broadcast_id;

  RETURN v_inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_broadcast_targets_for_audience(uuid, uuid, uuid, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_broadcast_targets_for_audience(uuid, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_broadcast_targets_for_audience(uuid, uuid, uuid, uuid) TO service_role;
