CREATE TABLE public.broadcast_dispatch_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL,
  target_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  automation_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  conversation_id uuid NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text NULL,
  claimed_at timestamptz NULL,
  dispatched_at timestamptz NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT broadcast_dispatch_queue_status_check CHECK (status IN ('pending', 'processing', 'dispatched', 'failed', 'skipped')),
  CONSTRAINT broadcast_dispatch_queue_attempts_check CHECK (attempts >= 0),
  CONSTRAINT broadcast_dispatch_queue_target_unique UNIQUE (target_id)
);

GRANT SELECT ON public.broadcast_dispatch_queue TO authenticated;
GRANT ALL ON public.broadcast_dispatch_queue TO service_role;

ALTER TABLE public.broadcast_dispatch_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "broadcast_dispatch_queue_admin_all"
ON public.broadcast_dispatch_queue
FOR ALL
TO authenticated
USING (is_admin(auth.uid()))
WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "broadcast_dispatch_queue_select_member"
ON public.broadcast_dispatch_queue
FOR SELECT
TO authenticated
USING (has_brand_access(auth.uid(), brand_id));

CREATE INDEX idx_broadcast_dispatch_queue_broadcast_status ON public.broadcast_dispatch_queue (broadcast_id, status, next_attempt_at);
CREATE INDEX idx_broadcast_dispatch_queue_status_next ON public.broadcast_dispatch_queue (status, next_attempt_at, created_at);
CREATE INDEX idx_broadcast_dispatch_queue_claimed ON public.broadcast_dispatch_queue (claimed_at) WHERE status = 'processing';
CREATE INDEX idx_broadcast_dispatch_queue_contact ON public.broadcast_dispatch_queue (contact_id);

CREATE OR REPLACE FUNCTION public.enqueue_broadcast_dispatches(_broadcast_id uuid, _limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  WITH picked AS (
    SELECT t.id, t.contact_id, b.id AS broadcast_id, b.brand_id, b.automation_id
      FROM public.broadcast_targets t
      JOIN public.broadcasts b ON b.id = t.broadcast_id
     WHERE t.broadcast_id = _broadcast_id
       AND b.status = 'running'
       AND t.status = 'pending'
       AND t.run_id IS NULL
     ORDER BY t.created_at
     LIMIT GREATEST(_limit, 0)
     FOR UPDATE OF t SKIP LOCKED
  ), updated_targets AS (
    UPDATE public.broadcast_targets bt
       SET status = 'processing',
           claimed_at = now(),
           error = NULL
      FROM picked p
     WHERE bt.id = p.id
     RETURNING bt.id, bt.contact_id, p.broadcast_id, p.brand_id, p.automation_id
  ), inserted AS (
    INSERT INTO public.broadcast_dispatch_queue (
      broadcast_id, target_id, brand_id, automation_id, contact_id, status, next_attempt_at, updated_at
    )
    SELECT broadcast_id, id, brand_id, automation_id, contact_id, 'pending', now(), now()
      FROM updated_targets
    ON CONFLICT (target_id) DO UPDATE
      SET status = CASE
            WHEN public.broadcast_dispatch_queue.status IN ('failed', 'skipped') THEN public.broadcast_dispatch_queue.status
            WHEN public.broadcast_dispatch_queue.status = 'dispatched' THEN public.broadcast_dispatch_queue.status
            ELSE 'pending'
          END,
          next_attempt_at = CASE
            WHEN public.broadcast_dispatch_queue.status IN ('dispatched', 'failed', 'skipped') THEN public.broadcast_dispatch_queue.next_attempt_at
            ELSE now()
          END,
          claimed_at = CASE
            WHEN public.broadcast_dispatch_queue.status IN ('dispatched', 'failed', 'skipped') THEN public.broadcast_dispatch_queue.claimed_at
            ELSE NULL
          END,
          updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM inserted;

  RETURN COALESCE(v_count, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_broadcast_dispatch_queue(_limit integer)
RETURNS TABLE(
  id uuid,
  broadcast_id uuid,
  target_id uuid,
  brand_id uuid,
  automation_id uuid,
  contact_id uuid,
  conversation_id uuid,
  attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT q.id
      FROM public.broadcast_dispatch_queue q
      JOIN public.broadcasts b ON b.id = q.broadcast_id
     WHERE q.status = 'pending'
       AND q.next_attempt_at <= now()
       AND b.status = 'running'
     ORDER BY q.created_at
     LIMIT GREATEST(_limit, 0)
     FOR UPDATE OF q SKIP LOCKED
  )
  UPDATE public.broadcast_dispatch_queue q
     SET status = 'processing',
         claimed_at = now(),
         attempts = q.attempts + 1,
         updated_at = now()
    FROM picked
   WHERE q.id = picked.id
   RETURNING q.id, q.broadcast_id, q.target_id, q.brand_id, q.automation_id, q.contact_id, q.conversation_id, q.attempts;
END;
$function$;

CREATE OR REPLACE FUNCTION public.requeue_stuck_broadcast_dispatches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_count integer;
BEGIN
  UPDATE public.broadcast_dispatch_queue q
     SET status = 'pending',
         claimed_at = NULL,
         next_attempt_at = now(),
         updated_at = now(),
         last_error = COALESCE(last_error, 'Worker interrompido antes de finalizar')
   WHERE q.status = 'processing'
     AND q.claimed_at < now() - interval '90 seconds'
     AND NOT EXISTS (
       SELECT 1
         FROM public.broadcast_targets t
        WHERE t.id = q.target_id
          AND t.run_id IS NOT NULL
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finish_broadcast_dispatch(
  _queue_id uuid,
  _target_id uuid,
  _status text,
  _run_id uuid DEFAULT NULL,
  _conversation_id uuid DEFAULT NULL,
  _error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_ok boolean := false;
BEGIN
  IF _status NOT IN ('dispatched', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'invalid dispatch status: %', _status;
  END IF;

  UPDATE public.broadcast_dispatch_queue q
     SET status = _status,
         conversation_id = COALESCE(_conversation_id, q.conversation_id),
         last_error = _error,
         claimed_at = NULL,
         dispatched_at = CASE WHEN _status = 'dispatched' THEN v_now ELSE q.dispatched_at END,
         updated_at = v_now
   WHERE q.id = _queue_id
     AND q.target_id = _target_id
   RETURNING true INTO v_ok;

  IF COALESCE(v_ok, false) THEN
    UPDATE public.broadcast_targets t
       SET status = _status::broadcast_target_status,
           error = _error,
           run_id = CASE WHEN _status = 'dispatched' THEN COALESCE(_run_id, t.run_id) ELSE t.run_id END,
           dispatched_at = CASE WHEN _status = 'dispatched' THEN v_now ELSE t.dispatched_at END,
           claimed_at = NULL
     WHERE t.id = _target_id;
  END IF;

  RETURN COALESCE(v_ok, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_or_retry_broadcast_dispatch(
  _queue_id uuid,
  _target_id uuid,
  _error text,
  _max_attempts integer DEFAULT 4
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_attempts integer;
  v_status text;
  v_backoff interval;
BEGIN
  SELECT attempts INTO v_attempts
    FROM public.broadcast_dispatch_queue
   WHERE id = _queue_id
     AND target_id = _target_id;

  IF v_attempts IS NULL THEN
    RETURN 'missing';
  END IF;

  IF v_attempts >= GREATEST(_max_attempts, 1) THEN
    v_status := 'failed';
    UPDATE public.broadcast_dispatch_queue
       SET status = 'failed',
           last_error = LEFT(COALESCE(_error, 'Falha no envio'), 500),
           claimed_at = NULL,
           updated_at = now()
     WHERE id = _queue_id;

    UPDATE public.broadcast_targets
       SET status = 'failed',
           error = LEFT(COALESCE(_error, 'Falha no envio'), 500),
           claimed_at = NULL
     WHERE id = _target_id
       AND run_id IS NULL;
  ELSE
    v_status := 'pending';
    v_backoff := CASE
      WHEN v_attempts <= 1 THEN interval '30 seconds'
      WHEN v_attempts = 2 THEN interval '2 minutes'
      ELSE interval '10 minutes'
    END;

    UPDATE public.broadcast_dispatch_queue
       SET status = 'pending',
           last_error = LEFT(COALESCE(_error, 'Falha temporária no envio'), 500),
           claimed_at = NULL,
           next_attempt_at = now() + v_backoff,
           updated_at = now()
     WHERE id = _queue_id;
  END IF;

  RETURN v_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.requeue_stuck_broadcast_targets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_count int;
BEGIN
  UPDATE public.broadcast_targets t
     SET status = 'pending',
         claimed_at = NULL
   WHERE t.status = 'processing'
     AND t.run_id IS NULL
     AND (t.claimed_at IS NULL OR t.claimed_at < now() - interval '90 seconds')
     AND NOT EXISTS (
       SELECT 1
         FROM public.broadcast_dispatch_queue q
        WHERE q.target_id = t.id
          AND q.status IN ('pending', 'processing')
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recount_broadcast_progress(_broadcast_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.broadcasts b SET
    dispatched_count = s.d,
    failed_count     = s.f,
    skipped_count    = s.k,
    status = CASE
      WHEN s.open_count = 0 AND b.status = 'running' THEN 'completed'::broadcast_status
      ELSE b.status
    END,
    finished_at = CASE
      WHEN s.open_count = 0 AND b.status = 'running' AND b.finished_at IS NULL THEN now()
      ELSE b.finished_at
    END
  FROM (
    SELECT
      count(*) FILTER (WHERE status = 'dispatched') AS d,
      count(*) FILTER (WHERE status = 'failed')     AS f,
      count(*) FILTER (WHERE status = 'skipped')    AS k,
      count(*) FILTER (WHERE status IN ('pending', 'processing')) AS open_count
    FROM public.broadcast_targets
    WHERE broadcast_id = _broadcast_id
  ) s
  WHERE b.id = _broadcast_id;
$function$;