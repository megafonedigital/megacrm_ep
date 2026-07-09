CREATE TABLE IF NOT EXISTS public.broadcast_runtime_locks (
  name text PRIMARY KEY,
  owner text NOT NULL,
  locked_until timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.broadcast_runtime_locks TO service_role;

ALTER TABLE public.broadcast_runtime_locks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.try_acquire_broadcast_tick_lock(
  _owner text,
  _ttl_seconds integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamp with time zone := now();
  v_ttl integer := greatest(10, least(coalesce(_ttl_seconds, 60), 300));
  v_acquired boolean := false;
BEGIN
  INSERT INTO public.broadcast_runtime_locks (name, owner, locked_until, updated_at)
  VALUES ('broadcast_tick', coalesce(nullif(_owner, ''), 'unknown'), v_now + make_interval(secs => v_ttl), v_now)
  ON CONFLICT (name) DO UPDATE
    SET owner = excluded.owner,
        locked_until = excluded.locked_until,
        updated_at = excluded.updated_at
  WHERE public.broadcast_runtime_locks.locked_until < v_now
     OR public.broadcast_runtime_locks.owner = excluded.owner
  RETURNING true INTO v_acquired;

  RETURN coalesce(v_acquired, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_broadcast_tick_lock(_owner text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.broadcast_runtime_locks
   WHERE name = 'broadcast_tick'
     AND owner = coalesce(nullif(_owner, ''), 'unknown');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.try_acquire_broadcast_tick_lock(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_broadcast_tick_lock(text) TO service_role;

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

CREATE OR REPLACE FUNCTION public.requeue_stuck_broadcast_targets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_count int;
BEGIN
  UPDATE public.broadcast_targets
     SET status = 'pending',
         claimed_at = NULL
   WHERE status = 'processing'
     AND (claimed_at IS NULL OR claimed_at < now() - interval '2 minutes');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

UPDATE public.broadcast_targets
   SET status = 'pending',
       claimed_at = NULL
 WHERE status = 'processing';

SELECT public.recount_broadcast_progress(id)
  FROM public.broadcasts
 WHERE status = 'running';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'broadcast-tick-every-minute') THEN
    PERFORM cron.unschedule('broadcast-tick-every-minute');
  END IF;
END $$;

SELECT cron.schedule(
  'broadcast-tick-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://megacrm1.lovable.app/api/public/cron/broadcast-tick',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6Im15bm12eWN3aGZleHdoeXp4bnpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDU3MjksImV4cCI6MjA5MzU4MTcyOX0.uBS4WdEcbHB2tO6VqW-EfJI9zNAUMT3-5KWOpTQ6cLk"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);