
ALTER TABLE public.contact_import_batches
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.claim_next_import_batch(_import_id uuid)
 RETURNS TABLE(id uuid, import_id uuid, batch_index integer, payload jsonb, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
  v_max_attempts CONSTANT INT := 5;
  v_stale_after  CONSTANT INTERVAL := interval '2 minutes';
BEGIN
  -- Marca como 'failed' lotes que excederam o número máximo de tentativas
  -- e ainda estão presos em 'processing' há muito tempo.
  UPDATE public.contact_import_batches b
     SET status = 'failed',
         processed_at = now(),
         error = COALESCE(b.error, 'Excedeu o número máximo de tentativas após worker travar.')
   WHERE b.import_id = _import_id
     AND b.status = 'processing'
     AND b.attempts >= v_max_attempts
     AND (b.claimed_at IS NULL OR b.claimed_at < now() - v_stale_after);

  -- Reivindica: prioridade para 'pending', depois 'processing' órfão.
  SELECT b.id INTO v_id
    FROM public.contact_import_batches b
   WHERE b.import_id = _import_id
     AND (
       b.status = 'pending'
       OR (
         b.status = 'processing'
         AND b.attempts < v_max_attempts
         AND (b.claimed_at IS NULL OR b.claimed_at < now() - v_stale_after)
       )
     )
   ORDER BY (b.status = 'processing'), b.batch_index
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF v_id IS NULL THEN RETURN; END IF;

  UPDATE public.contact_import_batches
     SET status = 'processing',
         attempts = public.contact_import_batches.attempts + 1,
         claimed_at = now()
   WHERE public.contact_import_batches.id = v_id;

  RETURN QUERY SELECT b.id, b.import_id, b.batch_index, b.payload, b.attempts
    FROM public.contact_import_batches b WHERE b.id = v_id;
END; $function$;

-- Destrava o import atual: volta lotes presos para pending.
UPDATE public.contact_import_batches
   SET status = 'pending',
       attempts = 0,
       claimed_at = NULL,
       error = NULL,
       processed_at = NULL
 WHERE import_id = 'bfc93ab6-8777-46f9-bb2e-0c4d9acc1d30'
   AND status = 'processing';
