
ALTER TABLE public.broadcast_dispatch_queue
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS wa_id text;

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
  ), enriched AS (
    SELECT l.id,
           l.created_at,
           t.contact_id,
           b.id AS broadcast_id,
           b.brand_id,
           b.automation_id,
           c.phone,
           c.name AS contact_name,
           c.wa_id,
           conv.conv_id,
           bl.id AS blocklist_id
      FROM locked l
      JOIN public.broadcast_targets t ON t.id = l.id
      JOIN public.broadcasts b ON b.id = t.broadcast_id
      LEFT JOIN public.contacts c ON c.id = t.contact_id
      LEFT JOIN LATERAL (
        SELECT cv.id AS conv_id
          FROM public.conversations cv
         WHERE cv.brand_id = b.brand_id
           AND cv.contact_id = t.contact_id
         ORDER BY cv.created_at DESC
         LIMIT 1
      ) conv ON true
      LEFT JOIN public.contact_blocklist bl
        ON bl.brand_id = b.brand_id
       AND bl.kind = 'phone'
       AND bl.value = c.phone
  ), blocked_update AS (
    UPDATE public.broadcast_targets t
       SET status = 'skipped',
           claimed_at = now(),
           error = 'Contato no blocklist'
      FROM enriched e
     WHERE t.id = e.id
       AND e.blocklist_id IS NOT NULL
    RETURNING t.id
  ), picked AS (
    SELECT e.id,
           e.contact_id,
           e.broadcast_id,
           e.brand_id,
           e.automation_id,
           e.phone,
           e.contact_name,
           e.wa_id,
           e.conv_id,
           row_number() OVER (ORDER BY e.created_at) AS rn
      FROM enriched e
     WHERE e.blocklist_id IS NULL
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
              p.phone,
              p.contact_name,
              p.wa_id,
              p.conv_id,
              p.rn
  ), inserted AS (
    INSERT INTO public.broadcast_dispatch_queue
      (broadcast_id, target_id, brand_id, automation_id, contact_id,
       conversation_id, phone, contact_name, wa_id,
       status, next_attempt_at, scheduled_send_at, created_at, updated_at)
    SELECT ut.broadcast_id,
           ut.target_id,
           ut.brand_id,
           ut.automation_id,
           ut.contact_id,
           ut.conv_id,
           ut.phone,
           ut.contact_name,
           ut.wa_id,
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
          phone = COALESCE(EXCLUDED.phone, public.broadcast_dispatch_queue.phone),
          contact_name = COALESCE(EXCLUDED.contact_name, public.broadcast_dispatch_queue.contact_name),
          wa_id = COALESCE(EXCLUDED.wa_id, public.broadcast_dispatch_queue.wa_id),
          conversation_id = COALESCE(EXCLUDED.conversation_id, public.broadcast_dispatch_queue.conversation_id),
          updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM inserted;

  RETURN COALESCE(v_count, 0);
END;
$function$;

DROP FUNCTION IF EXISTS public.claim_broadcast_dispatch_queue(integer);

CREATE OR REPLACE FUNCTION public.claim_broadcast_dispatch_queue(_limit integer)
 RETURNS TABLE(id uuid, broadcast_id uuid, target_id uuid, brand_id uuid, automation_id uuid, contact_id uuid, conversation_id uuid, attempts integer, phone text, contact_name text, wa_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.broadcast_rate_state (broadcast_id, tokens, last_refill_at)
  SELECT b.id, 0, now()
    FROM public.broadcasts b
   WHERE b.status = 'running'
  ON CONFLICT ON CONSTRAINT broadcast_rate_state_pkey DO NOTHING;

  RETURN QUERY
  WITH
  refilled AS (
    UPDATE public.broadcast_rate_state s
       SET tokens = LEAST(
             GREATEST(5, ROUND(GREATEST(b.rate_per_minute, 1)::numeric / 30.0)),
             s.tokens + EXTRACT(EPOCH FROM (now() - s.last_refill_at))
                        * (GREATEST(b.rate_per_minute, 1)::numeric / 60.0)
           ),
           last_refill_at = now(),
           updated_at = now()
      FROM public.broadcasts b
     WHERE b.id = s.broadcast_id
       AND b.status = 'running'
    RETURNING s.broadcast_id, FLOOR(s.tokens)::int AS budget_remaining
  ),
  eligible AS (
    SELECT q.id AS queue_id,
           q.broadcast_id,
           row_number() OVER (PARTITION BY q.broadcast_id ORDER BY q.scheduled_send_at, q.created_at) AS rn
      FROM public.broadcast_dispatch_queue q
      JOIN refilled r ON r.broadcast_id = q.broadcast_id
     WHERE q.status = 'pending'
       AND q.next_attempt_at <= now()
       AND q.scheduled_send_at <= now()
       AND r.budget_remaining > 0
  ),
  capped AS (
    SELECT e.queue_id, e.broadcast_id
      FROM eligible e
      JOIN refilled r ON r.broadcast_id = e.broadcast_id
     WHERE e.rn <= r.budget_remaining
     ORDER BY e.rn, e.queue_id
     LIMIT GREATEST(_limit, 0)
  ),
  picked AS (
    SELECT q.id AS queue_id, q.broadcast_id
      FROM public.broadcast_dispatch_queue q
      JOIN capped c ON c.queue_id = q.id
     WHERE q.status = 'pending'
     FOR UPDATE OF q SKIP LOCKED
  ),
  consumed AS (
    UPDATE public.broadcast_rate_state s
       SET tokens = GREATEST(0, s.tokens - cnt.n),
           updated_at = now()
      FROM (
        SELECT p.broadcast_id, COUNT(*)::numeric AS n
          FROM picked p
         GROUP BY p.broadcast_id
      ) cnt
     WHERE s.broadcast_id = cnt.broadcast_id
    RETURNING s.broadcast_id
  ),
  updated AS (
    UPDATE public.broadcast_dispatch_queue q
       SET status = 'processing',
           claimed_at = now(),
           attempts = q.attempts + 1,
           updated_at = now()
      FROM picked p
     WHERE q.id = p.queue_id
    RETURNING q.id, q.broadcast_id, q.target_id, q.brand_id, q.automation_id,
              q.contact_id, q.conversation_id, q.attempts,
              q.phone, q.contact_name, q.wa_id
  )
  SELECT u.id, u.broadcast_id, u.target_id, u.brand_id, u.automation_id,
         u.contact_id, u.conversation_id, u.attempts,
         u.phone, u.contact_name, u.wa_id
    FROM updated u
    WHERE (SELECT COUNT(*) FROM consumed) >= 0;
END;
$function$;
