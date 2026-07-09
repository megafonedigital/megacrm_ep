CREATE OR REPLACE FUNCTION public.enqueue_broadcast_dispatches(_broadcast_id uuid, _limit integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  v_rate integer;
  v_base timestamptz;
  v_interval_ms numeric;
BEGIN
  SELECT GREATEST(1, b.rate_per_minute) INTO v_rate
    FROM public.broadcasts b
   WHERE b.id = _broadcast_id AND b.status = 'running';
  IF v_rate IS NULL THEN
    RETURN 0;
  END IF;

  v_interval_ms := 60000.0 / v_rate;

  -- Base: só considera itens FUTUROS já enfileirados; ignora horários antigos
  -- atrasados. Garante que novos lotes nunca caem antes de "agora".
  SELECT GREATEST(
           now(),
           COALESCE(MAX(q.scheduled_send_at) + make_interval(secs => v_interval_ms / 1000.0), now())
         )
    INTO v_base
    FROM public.broadcast_dispatch_queue q
   WHERE q.broadcast_id = _broadcast_id
     AND q.status IN ('pending', 'processing')
     AND q.scheduled_send_at > now();

  IF v_base IS NULL THEN
    v_base := now();
  END IF;

  WITH locked AS (
    SELECT t.id, t.created_at
      FROM public.broadcast_targets t
      JOIN public.broadcasts b ON b.id = t.broadcast_id
     WHERE t.broadcast_id = _broadcast_id
       AND b.status = 'running'
       AND t.status = 'pending'
       AND t.run_id IS NULL
     ORDER BY t.created_at
     LIMIT CASE WHEN _limit IS NULL OR _limit <= 0 THEN NULL ELSE _limit END
     FOR UPDATE OF t SKIP LOCKED
  ), picked AS (
    SELECT l.id,
           t.contact_id,
           b.id AS broadcast_id,
           b.brand_id,
           b.automation_id,
           row_number() OVER (ORDER BY l.created_at) AS rn
      FROM locked l
      JOIN public.broadcast_targets t ON t.id = l.id
      JOIN public.broadcasts b ON b.id = t.broadcast_id
  ), updated_targets AS (
    UPDATE public.broadcast_targets bt
       SET status = 'processing',
           claimed_at = now(),
           error = NULL
      FROM picked p
     WHERE bt.id = p.id
     RETURNING bt.id, bt.contact_id, p.broadcast_id, p.brand_id, p.automation_id, p.rn
  ), inserted AS (
    INSERT INTO public.broadcast_dispatch_queue (
      broadcast_id, target_id, brand_id, automation_id, contact_id, status,
      next_attempt_at, scheduled_send_at, updated_at
    )
    SELECT
      ut.broadcast_id, ut.id, ut.brand_id, ut.automation_id, ut.contact_id, 'pending',
      v_base + make_interval(secs => ((ut.rn - 1) * v_interval_ms) / 1000.0),
      v_base + make_interval(secs => ((ut.rn - 1) * v_interval_ms) / 1000.0)
        + make_interval(secs => (random() * 0.2)),
      now()
      FROM updated_targets ut
    ON CONFLICT (target_id) DO UPDATE
      SET status = CASE
            WHEN public.broadcast_dispatch_queue.status IN ('failed', 'skipped', 'dispatched')
              THEN public.broadcast_dispatch_queue.status
            ELSE 'pending'
          END,
          next_attempt_at = CASE
            WHEN public.broadcast_dispatch_queue.status IN ('dispatched', 'failed', 'skipped')
              THEN public.broadcast_dispatch_queue.next_attempt_at
            ELSE EXCLUDED.next_attempt_at
          END,
          scheduled_send_at = CASE
            WHEN public.broadcast_dispatch_queue.status IN ('dispatched', 'failed', 'skipped')
              THEN public.broadcast_dispatch_queue.scheduled_send_at
            ELSE EXCLUDED.scheduled_send_at
          END,
          claimed_at = CASE
            WHEN public.broadcast_dispatch_queue.status IN ('dispatched', 'failed', 'skipped')
              THEN public.broadcast_dispatch_queue.claimed_at
            ELSE NULL
          END,
          updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM inserted;

  RETURN COALESCE(v_count, 0);
END;
$function$;