CREATE OR REPLACE FUNCTION public.claim_next_import_batch(_import_id uuid)
 RETURNS TABLE(id uuid, import_id uuid, batch_index integer, payload jsonb, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id UUID;
BEGIN
  SELECT b.id INTO v_id FROM public.contact_import_batches b
  WHERE b.import_id = _import_id AND b.status = 'pending'
  ORDER BY b.batch_index FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;
  UPDATE public.contact_import_batches
     SET status = 'processing',
         attempts = public.contact_import_batches.attempts + 1
   WHERE public.contact_import_batches.id = v_id;
  RETURN QUERY SELECT b.id, b.import_id, b.batch_index, b.payload, b.attempts
    FROM public.contact_import_batches b WHERE b.id = v_id;
END; $function$;