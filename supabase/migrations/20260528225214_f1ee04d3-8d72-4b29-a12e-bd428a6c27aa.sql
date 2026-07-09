CREATE OR REPLACE FUNCTION public.claim_next_pending_import()
RETURNS TABLE(id uuid, brand_id uuid, tag_ids uuid[], update_existing boolean, created_by uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id UUID;
BEGIN
  SELECT ci.id INTO v_id FROM public.contact_imports ci
  WHERE ci.status IN ('queued','running')
    AND EXISTS (
      SELECT 1 FROM public.contact_import_batches b
      WHERE b.import_id = ci.id
        AND (
          b.status = 'pending'
          OR (
            b.status = 'processing'
            AND (b.claimed_at IS NULL OR b.claimed_at < now() - interval '2 minutes')
          )
        )
    )
  ORDER BY ci.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;
  UPDATE public.contact_imports SET status='running', started_at=COALESCE(started_at, now()) WHERE contact_imports.id=v_id;
  RETURN QUERY SELECT ci.id, ci.brand_id, ci.tag_ids, ci.update_existing, ci.created_by
    FROM public.contact_imports ci WHERE ci.id=v_id;
END; $function$;