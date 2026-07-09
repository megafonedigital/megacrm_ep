-- 1) GIN index on metadata->'tags' for fast jsonb @> lookups
CREATE INDEX IF NOT EXISTS idx_contacts_brand_metadata_tags
  ON public.contacts USING gin ((metadata -> 'tags') jsonb_path_ops);

-- 2) Rewrite search_contacts_by_tag to filter by tag NAME against metadata->tags
CREATE OR REPLACE FUNCTION public.search_contacts_by_tag(
  _brand_id uuid,
  _tag_id uuid,
  _search text DEFAULT NULL::text,
  _sort_by text DEFAULT 'name'::text,
  _sort_dir text DEFAULT 'asc'::text,
  _limit integer DEFAULT 25,
  _offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, brand_id uuid, name text, profile_name text,
  phone text, wa_id text, email text,
  created_at timestamp with time zone, total_count bigint
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _tag_name text;
BEGIN
  SELECT t.name INTO _tag_name FROM public.tags t WHERE t.id = _tag_id;
  IF _tag_name IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT c.*
      FROM public.contacts c
     WHERE c.brand_id = _brand_id
       AND c.metadata -> 'tags' @> jsonb_build_array(_tag_name)
       AND (
         _search IS NULL OR length(trim(_search)) = 0
         OR c.name         ILIKE '%'||_search||'%'
         OR c.profile_name ILIKE '%'||_search||'%'
         OR c.phone        ILIKE '%'||_search||'%'
         OR c.wa_id        ILIKE '%'||_search||'%'
       )
  )
  SELECT f.id, f.brand_id, f.name, f.profile_name, f.phone, f.wa_id,
         (f.metadata->>'email') AS email,
         f.created_at,
         count(*) OVER () AS total_count
    FROM filtered f
   ORDER BY
     CASE WHEN _sort_by = 'created_at' AND lower(_sort_dir) = 'desc' THEN f.created_at END DESC NULLS LAST,
     CASE WHEN _sort_by = 'created_at' AND lower(_sort_dir) = 'asc'  THEN f.created_at END ASC  NULLS LAST,
     CASE WHEN _sort_by <> 'created_at' AND lower(_sort_dir) = 'desc' THEN coalesce(f.name, f.profile_name) END DESC NULLS LAST,
     CASE WHEN _sort_by <> 'created_at' AND lower(_sort_dir) = 'asc'  THEN coalesce(f.name, f.profile_name) END ASC  NULLS LAST,
     f.id ASC
   LIMIT greatest(least(coalesce(_limit, 25), 500), 1)
  OFFSET greatest(coalesce(_offset, 0), 0);
END;
$function$;

-- 3) New search_contacts_no_tag for the "Sem tag" case
CREATE OR REPLACE FUNCTION public.search_contacts_no_tag(
  _brand_id uuid,
  _search text DEFAULT NULL::text,
  _sort_by text DEFAULT 'name'::text,
  _sort_dir text DEFAULT 'asc'::text,
  _limit integer DEFAULT 25,
  _offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, brand_id uuid, name text, profile_name text,
  phone text, wa_id text, email text,
  created_at timestamp with time zone, total_count bigint
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH filtered AS (
    SELECT c.*
      FROM public.contacts c
     WHERE c.brand_id = _brand_id
       AND (
         c.metadata -> 'tags' IS NULL
         OR c.metadata -> 'tags' = '[]'::jsonb
       )
       AND (
         _search IS NULL OR length(trim(_search)) = 0
         OR c.name         ILIKE '%'||_search||'%'
         OR c.profile_name ILIKE '%'||_search||'%'
         OR c.phone        ILIKE '%'||_search||'%'
         OR c.wa_id        ILIKE '%'||_search||'%'
       )
  )
  SELECT f.id, f.brand_id, f.name, f.profile_name, f.phone, f.wa_id,
         (f.metadata->>'email') AS email,
         f.created_at,
         count(*) OVER () AS total_count
    FROM filtered f
   ORDER BY
     CASE WHEN _sort_by = 'created_at' AND lower(_sort_dir) = 'desc' THEN f.created_at END DESC NULLS LAST,
     CASE WHEN _sort_by = 'created_at' AND lower(_sort_dir) = 'asc'  THEN f.created_at END ASC  NULLS LAST,
     CASE WHEN _sort_by <> 'created_at' AND lower(_sort_dir) = 'desc' THEN coalesce(f.name, f.profile_name) END DESC NULLS LAST,
     CASE WHEN _sort_by <> 'created_at' AND lower(_sort_dir) = 'asc'  THEN coalesce(f.name, f.profile_name) END ASC  NULLS LAST,
     f.id ASC
   LIMIT greatest(least(coalesce(_limit, 25), 500), 1)
  OFFSET greatest(coalesce(_offset, 0), 0);
$function$;

GRANT EXECUTE ON FUNCTION public.search_contacts_by_tag(uuid, uuid, text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_contacts_no_tag(uuid, text, text, text, integer, integer) TO authenticated;