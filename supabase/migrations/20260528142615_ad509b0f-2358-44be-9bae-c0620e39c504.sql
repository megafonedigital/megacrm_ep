REVOKE EXECUTE ON FUNCTION public.enqueue_broadcast_dispatches(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_broadcast_dispatch_queue(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.requeue_stuck_broadcast_dispatches() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finish_broadcast_dispatch(uuid, uuid, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fail_or_retry_broadcast_dispatch(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_broadcast_dispatches(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_broadcast_dispatch_queue(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_stuck_broadcast_dispatches() TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_broadcast_dispatch(uuid, uuid, text, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_or_retry_broadcast_dispatch(uuid, uuid, text, integer) TO service_role;