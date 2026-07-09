CREATE OR REPLACE FUNCTION public.search_contacts(
  _brand_id uuid,
  _search text DEFAULT NULL,
  _tag_id uuid DEFAULT NULL,
  _no_tag boolean DEFAULT false,
  _field_key text DEFAULT NULL,
  _field_op text DEFAULT NULL,
  _field_val text DEFAULT NULL,
  _field_val2 text DEFAULT NULL,
  _field_vals text[] DEFAULT NULL,
  _sort_by text DEFAULT 'name',
  _sort_dir text DEFAULT 'asc',
  _limit int DEFAULT 25,
  _offset int DEFAULT 0
) RETURNS TABLE (
  id uuid,
  brand_id uuid,
  name text,
  profile_name text,
  phone text,
  wa_id text,
  email text,
  created_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  sql text;
  where_parts text[] := ARRAY[]::text[];
  order_clause text;
  field_col text;
  dir text;
  lim int := LEAST(GREATEST(coalesce(_limit, 25), 1), 500);
  off int := GREATEST(coalesce(_offset, 0), 0);
BEGIN
  dir := CASE WHEN lower(coalesce(_sort_dir,'asc')) = 'desc' THEN 'DESC' ELSE 'ASC' END;

  where_parts := array_append(where_parts, format('c.brand_id = %L', _brand_id));

  IF _tag_id IS NOT NULL THEN
    where_parts := array_append(where_parts, format('EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = %L)', _tag_id));
  ELSIF _no_tag THEN
    where_parts := array_append(where_parts, 'NOT EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id)');
  END IF;

  IF _search IS NOT NULL AND length(trim(_search)) > 0 THEN
    where_parts := array_append(where_parts, format(
      '(c.name ILIKE %L OR c.profile_name ILIKE %L OR c.phone ILIKE %L OR c.wa_id ILIKE %L)',
      '%'||_search||'%','%'||_search||'%','%'||_search||'%','%'||_search||'%'
    ));
  END IF;

  IF _field_key IS NOT NULL AND _field_op IS NOT NULL THEN
    field_col := format('(c.metadata->''custom''->>%L)', _field_key);
    CASE _field_op
      WHEN 'contains' THEN where_parts := array_append(where_parts, format('%s ILIKE %L', field_col, '%'||coalesce(_field_val,'')||'%'));
      WHEN 'starts_with' THEN where_parts := array_append(where_parts, format('%s ILIKE %L', field_col, coalesce(_field_val,'')||'%'));
      WHEN 'eq' THEN where_parts := array_append(where_parts, format('%s = %L', field_col, coalesce(_field_val,'')));
      WHEN 'neq' THEN where_parts := array_append(where_parts, format('%s <> %L', field_col, coalesce(_field_val,'')));
      WHEN 'gt' THEN where_parts := array_append(where_parts, format('%s > %L', field_col, coalesce(_field_val,'')));
      WHEN 'lt' THEN where_parts := array_append(where_parts, format('%s < %L', field_col, coalesce(_field_val,'')));
      WHEN 'before' THEN where_parts := array_append(where_parts, format('%s < %L', field_col, coalesce(_field_val,'')));
      WHEN 'after' THEN where_parts := array_append(where_parts, format('%s > %L', field_col, coalesce(_field_val,'')));
      WHEN 'between' THEN where_parts := array_append(where_parts, format('%s >= %L AND %s <= %L', field_col, coalesce(_field_val,''), field_col, coalesce(_field_val2,'')));
      WHEN 'in' THEN where_parts := array_append(where_parts, format('%s = ANY (%L::text[])', field_col, coalesce(_field_vals, ARRAY[]::text[])));
      WHEN 'is_true' THEN where_parts := array_append(where_parts, format('%s = ''true''', field_col));
      WHEN 'is_false' THEN where_parts := array_append(where_parts, format('%s = ''false''', field_col));
      WHEN 'empty' THEN where_parts := array_append(where_parts, format('(%s IS NULL OR %s = '''')', field_col, field_col));
      WHEN 'not_empty' THEN where_parts := array_append(where_parts, format('(%s IS NOT NULL AND %s <> '''')', field_col, field_col));
      ELSE NULL;
    END CASE;
  END IF;

  IF _sort_by = 'created_at' THEN
    order_clause := format('ORDER BY c.created_at %s, c.id ASC', dir);
  ELSE
    order_clause := format('ORDER BY c.name %s NULLS LAST, c.profile_name %s NULLS LAST, c.id ASC', dir, dir);
  END IF;

  sql := format($q$
    SELECT c.id, c.brand_id, c.name, c.profile_name, c.phone, c.wa_id,
           (c.metadata->>'email') AS email,
           c.created_at,
           count(*) OVER () AS total_count
      FROM public.contacts c
     WHERE %s
     %s
     LIMIT %s OFFSET %s
  $q$, array_to_string(where_parts, ' AND '), order_clause, lim, off);

  RETURN QUERY EXECUTE sql;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.search_contacts(uuid, text, uuid, boolean, text, text, text, text, text[], text, text, int, int) TO authenticated, service_role;