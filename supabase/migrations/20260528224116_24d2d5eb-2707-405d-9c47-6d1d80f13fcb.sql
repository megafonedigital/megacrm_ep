CREATE OR REPLACE FUNCTION public.increment_import_counters(
  _import_id uuid,
  _processed int,
  _created int,
  _updated int,
  _skipped int,
  _errors int
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.contact_imports
     SET processed_rows = processed_rows + COALESCE(_processed, 0),
         created_count  = created_count  + COALESCE(_created,   0),
         updated_count  = updated_count  + COALESCE(_updated,   0),
         skipped_count  = skipped_count  + COALESCE(_skipped,   0),
         error_count    = error_count    + COALESCE(_errors,    0)
   WHERE id = _import_id;
$$;

GRANT EXECUTE ON FUNCTION public.increment_import_counters(uuid,int,int,int,int,int) TO service_role;