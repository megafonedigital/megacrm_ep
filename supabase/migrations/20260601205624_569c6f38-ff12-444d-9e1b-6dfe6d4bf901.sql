ALTER FUNCTION public.search_contacts_by_tag(uuid, uuid, text, text, text, integer, integer) SECURITY DEFINER;
ALTER FUNCTION public.search_contacts_no_tag(uuid, text, text, text, integer, integer) SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.search_contacts_by_tag(_brand_id uuid, _tag_id uuid, _search text DEFAULT NULL::text, _sort_by text DEFAULT 'name'::text, _sort_dir text DEFAULT 'asc'::text, _limit integer DEFAULT 25, _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, brand_id uuid, name text, profile_name text, phone text, wa_id text, email text, created_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tag_name text;
  _order_sql text;
  _sort_col text;
  _sort_dir_norm text;
  _total bigint := NULL;
  _sql text;
BEGIN
  IF NOT public.has_brand_access(auth.uid(), _brand_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT t.name INTO _tag_name FROM public.tags t WHERE t.id = _tag_id;
  IF _tag_name IS NULL THEN
    RETURN;
  END IF;

  _sort_col := CASE WHEN lower(coalesce(_sort_by,'name')) = 'created_at' THEN 'c.created_at'
                    ELSE 'coalesce(c.name, c.profile_name)' END;
  _sort_dir_norm := CASE WHEN lower(coalesce(_sort_dir,'asc')) = 'desc' THEN 'DESC' ELSE 'ASC' END;
  _order_sql := format('ORDER BY %s %s NULLS LAST, c.id ASC', _sort_col, _sort_dir_norm);

  IF coalesce(_offset, 0) = 0 THEN
    SELECT count(*) INTO _total
      FROM public.contacts c
     WHERE c.brand_id = _brand_id
       AND c.metadata -> 'tags' @> jsonb_build_array(_tag_name)
       AND (
         _search IS NULL OR length(trim(_search)) = 0
         OR c.name ILIKE '%'||_search||'%'
         OR c.profile_name ILIKE '%'||_search||'%'
         OR c.phone ILIKE '%'||_search||'%'
         OR c.wa_id ILIKE '%'||_search||'%'
         OR c.metadata->>'email' ILIKE '%'||_search||'%'
       );
  END IF;

  _sql := format($q$
    SELECT c.id, c.brand_id, c.name, c.profile_name, c.phone, c.wa_id,
           (c.metadata->>'email') AS email,
           c.created_at,
           $1::bigint AS total_count
      FROM public.contacts c
     WHERE c.brand_id = $2
       AND c.metadata -> 'tags' @> jsonb_build_array($3::text)
       AND (
         $4 IS NULL OR length(trim($4)) = 0
         OR c.name ILIKE '%%'||$4||'%%'
         OR c.profile_name ILIKE '%%'||$4||'%%'
         OR c.phone ILIKE '%%'||$4||'%%'
         OR c.wa_id ILIKE '%%'||$4||'%%'
         OR c.metadata->>'email' ILIKE '%%'||$4||'%%'
       )
     %s
     LIMIT $5 OFFSET $6
  $q$, _order_sql);

  RETURN QUERY EXECUTE _sql
    USING _total, _brand_id, _tag_name, _search,
          greatest(least(coalesce(_limit, 25), 500), 1),
          greatest(coalesce(_offset, 0), 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_contacts_no_tag(_brand_id uuid, _search text DEFAULT NULL::text, _sort_by text DEFAULT 'name'::text, _sort_dir text DEFAULT 'asc'::text, _limit integer DEFAULT 25, _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, brand_id uuid, name text, profile_name text, phone text, wa_id text, email text, created_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _order_sql text;
  _sort_col text;
  _sort_dir_norm text;
  _total bigint := NULL;
  _sql text;
BEGIN
  IF NOT public.has_brand_access(auth.uid(), _brand_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  _sort_col := CASE WHEN lower(coalesce(_sort_by,'name')) = 'created_at' THEN 'c.created_at'
                    ELSE 'coalesce(c.name, c.profile_name)' END;
  _sort_dir_norm := CASE WHEN lower(coalesce(_sort_dir,'asc')) = 'desc' THEN 'DESC' ELSE 'ASC' END;
  _order_sql := format('ORDER BY %s %s NULLS LAST, c.id ASC', _sort_col, _sort_dir_norm);

  IF coalesce(_offset, 0) = 0 THEN
    SELECT count(*) INTO _total
      FROM public.contacts c
     WHERE c.brand_id = _brand_id
       AND (
         c.metadata -> 'tags' IS NULL
         OR jsonb_typeof(c.metadata -> 'tags') <> 'array'
         OR jsonb_array_length(c.metadata -> 'tags') = 0
       )
       AND (
         _search IS NULL OR length(trim(_search)) = 0
         OR c.name ILIKE '%'||_search||'%'
         OR c.profile_name ILIKE '%'||_search||'%'
         OR c.phone ILIKE '%'||_search||'%'
         OR c.wa_id ILIKE '%'||_search||'%'
         OR c.metadata->>'email' ILIKE '%'||_search||'%'
       );
  END IF;

  _sql := format($q$
    SELECT c.id, c.brand_id, c.name, c.profile_name, c.phone, c.wa_id,
           (c.metadata->>'email') AS email,
           c.created_at,
           $1::bigint AS total_count
      FROM public.contacts c
     WHERE c.brand_id = $2
       AND (
         c.metadata -> 'tags' IS NULL
         OR jsonb_typeof(c.metadata -> 'tags') <> 'array'
         OR jsonb_array_length(c.metadata -> 'tags') = 0
       )
       AND (
         $3 IS NULL OR length(trim($3)) = 0
         OR c.name ILIKE '%%'||$3||'%%'
         OR c.profile_name ILIKE '%%'||$3||'%%'
         OR c.phone ILIKE '%%'||$3||'%%'
         OR c.wa_id ILIKE '%%'||$3||'%%'
         OR c.metadata->>'email' ILIKE '%%'||$3||'%%'
       )
     %s
     LIMIT $4 OFFSET $5
  $q$, _order_sql);

  RETURN QUERY EXECUTE _sql
    USING _total, _brand_id, _search,
          greatest(least(coalesce(_limit, 25), 500), 1),
          greatest(coalesce(_offset, 0), 0);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.search_contacts_by_tag(uuid, uuid, text, text, text, integer, integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_contacts_no_tag(uuid, text, text, text, integer, integer) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_contacts_by_tag(uuid, uuid, text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_contacts_no_tag(uuid, text, text, text, integer, integer) TO authenticated;