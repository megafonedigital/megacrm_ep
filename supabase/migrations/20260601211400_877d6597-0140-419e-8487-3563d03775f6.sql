CREATE OR REPLACE FUNCTION public.finish_broadcast_dispatches_bulk(_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_count integer := 0;
BEGIN
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RETURN 0;
  END IF;

  WITH input AS (
    SELECT
      (x->>'queue_id')::uuid        AS queue_id,
      (x->>'target_id')::uuid       AS target_id,
      (x->>'status')                AS status,
      NULLIF(x->>'run_id','')::uuid AS run_id,
      NULLIF(x->>'conversation_id','')::uuid AS conversation_id,
      NULLIF(x->>'error','')        AS error
    FROM jsonb_array_elements(_items) AS x
  ),
  valid AS (
    SELECT * FROM input
    WHERE status IN ('dispatched','failed','skipped')
  ),
  upd_queue AS (
    UPDATE public.broadcast_dispatch_queue q
       SET status         = v.status,
           conversation_id = COALESCE(v.conversation_id, q.conversation_id),
           last_error     = v.error,
           claimed_at     = NULL,
           dispatched_at  = CASE WHEN v.status = 'dispatched' THEN v_now ELSE q.dispatched_at END,
           updated_at     = v_now
      FROM valid v
     WHERE q.id = v.queue_id
       AND q.target_id = v.target_id
    RETURNING v.target_id, v.status, v.run_id, v.error, v.conversation_id
  )
  UPDATE public.broadcast_targets t
     SET status        = uq.status::broadcast_target_status,
         error         = uq.error,
         run_id        = CASE WHEN uq.status = 'dispatched' THEN COALESCE(uq.run_id, t.run_id) ELSE t.run_id END,
         dispatched_at = CASE WHEN uq.status = 'dispatched' THEN v_now ELSE t.dispatched_at END,
         claimed_at    = NULL
    FROM upd_queue uq
   WHERE t.id = uq.target_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.finish_broadcast_dispatches_bulk(jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.finish_broadcast_dispatches_bulk(jsonb) TO authenticated, service_role;