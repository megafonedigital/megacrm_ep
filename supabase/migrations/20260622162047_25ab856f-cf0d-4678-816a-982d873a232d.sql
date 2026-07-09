
CREATE OR REPLACE FUNCTION public.snapshot_running_broadcast_health()
RETURNS TABLE(
  broadcast_id uuid,
  configured_rate integer,
  actual_rate_1m integer,
  dispatched_total integer,
  pending_total integer,
  processing_total integer,
  failed_total integer,
  tokens_available numeric,
  lag_ratio numeric,
  under_target boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _b record;
  _actual int;
  _disp int;
  _pend int;
  _proc int;
  _fail int;
  _tok numeric;
  _lag numeric;
  _under boolean;
BEGIN
  FOR _b IN
    SELECT b.id, b.rate_per_minute
      FROM public.broadcasts b
     WHERE b.status = 'running'
  LOOP
    SELECT COUNT(*)::int INTO _actual
      FROM public.broadcast_targets t
     WHERE t.broadcast_id = _b.id
       AND t.dispatched_at >= now() - interval '1 minute';

    SELECT
      COALESCE(SUM(CASE WHEN t.status='dispatched' THEN 1 ELSE 0 END),0)::int,
      COALESCE(SUM(CASE WHEN t.status='pending'    THEN 1 ELSE 0 END),0)::int,
      COALESCE(SUM(CASE WHEN t.status='processing' THEN 1 ELSE 0 END),0)::int,
      COALESCE(SUM(CASE WHEN t.status='failed'     THEN 1 ELSE 0 END),0)::int
      INTO _disp, _pend, _proc, _fail
      FROM public.broadcast_targets t
     WHERE t.broadcast_id = _b.id;

    SELECT COALESCE(s.tokens, 0) INTO _tok
      FROM public.broadcast_rate_state s
     WHERE s.broadcast_id = _b.id;
    IF _tok IS NULL THEN _tok := 0; END IF;

    IF _b.rate_per_minute > 0 THEN
      _lag := ROUND( (_actual::numeric / _b.rate_per_minute)::numeric, 3 );
      _under := (_actual::numeric < _b.rate_per_minute::numeric * 0.7
                 AND (_pend + _proc) > _b.rate_per_minute);
    ELSE
      _lag := 1;
      _under := false;
    END IF;

    INSERT INTO public.broadcast_health_snapshots (
      broadcast_id, configured_rate, actual_rate_1m,
      dispatched_total, pending_total, processing_total, failed_total,
      tokens_available, lag_ratio, under_target
    ) VALUES (
      _b.id, _b.rate_per_minute, _actual,
      _disp, _pend, _proc, _fail,
      _tok, _lag, _under
    );

    broadcast_id := _b.id;
    configured_rate := _b.rate_per_minute;
    actual_rate_1m := _actual;
    dispatched_total := _disp;
    pending_total := _pend;
    processing_total := _proc;
    failed_total := _fail;
    tokens_available := _tok;
    lag_ratio := _lag;
    under_target := _under;
    RETURN NEXT;
  END LOOP;

  DELETE FROM public.broadcast_health_snapshots WHERE captured_at < now() - interval '2 hours';
END;
$$;
