ALTER TABLE public.broadcast_dispatch_queue
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS contact_name,
  DROP COLUMN IF EXISTS wa_id;

CREATE OR REPLACE FUNCTION public.enqueue_broadcast_dispatches(_broadcast_id uuid, _limit integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  v_rate integer;
  v_started_at timestamptz;
  v_base timestamptz;
  v_max_sched timestamptz;
  v_interval_ms numeric;
  v_max_carry_ahead interval := interval '90 seconds';
  v_effective_limit integer;
BEGIN
  SELECT GREATEST(1, b.rate_per_minute), b.started_at
    INTO v_rate, v_started_at
    FROM public.broadcasts b
   WHERE b.id = _broadcast_id AND b.status = 'running';
  IF v_rate IS NULL THEN
    RETURN 0;
  END IF;

  v_interval_ms := 60000.0 / v_rate;

  v_effective_limit := CASE
    WHEN _limit IS NULL OR _limit <= 0 THEN GREATEST(500, CEIL(v_rate * 1.5)::int)
    ELSE _limit
  END;

  SELECT MAX(q.scheduled_send_at) INTO v_max_sched
    FROM public.broadcast_dispatch_queue q
   WHERE q.broadcast_id = _broadcast_id
     AND q.status IN ('pending', 'processing')
     AND q.scheduled_send_at > now();

  IF v_max_sched IS NOT NULL AND v_max_sched > now() + v_max_carry_ahead THEN
    RETURN 0;
  END IF;

  IF v_max_sched IS NULL THEN
    v_base := now();
  ELSE
    v_base := GREATEST(
      now() - interval '5 seconds',
      v_max_sched + make_interval(secs => v_interval_ms / 1000.0)
    );
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
     LIMIT v_effective_limit
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
    UPDATE public.broadcast_targets t
       SET status = 'processing',
           claimed_at = now()
      FROM picked p
     WHERE t.id = p.id
    RETURNING t.id AS target_id,
              p.contact_id,
              p.broadcast_id,
              p.brand_id,
              p.automation_id,
              p.rn
  ), inserted AS (
    INSERT INTO public.broadcast_dispatch_queue
      (broadcast_id, target_id, brand_id, automation_id, contact_id,
       status, next_attempt_at, scheduled_send_at, created_at, updated_at)
    SELECT ut.broadcast_id,
           ut.target_id,
           ut.brand_id,
           ut.automation_id,
           ut.contact_id,
           'pending',
           now(),
           v_base + make_interval(secs => ((ut.rn - 1) * v_interval_ms) / 1000.0),
           now(),
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