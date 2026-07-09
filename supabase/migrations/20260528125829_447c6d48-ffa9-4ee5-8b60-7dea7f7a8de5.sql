REVOKE ALL ON FUNCTION public.try_acquire_broadcast_tick_lock(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_acquire_broadcast_tick_lock(text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.try_acquire_broadcast_tick_lock(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_broadcast_tick_lock(text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.release_broadcast_tick_lock(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_broadcast_tick_lock(text) FROM anon;
REVOKE ALL ON FUNCTION public.release_broadcast_tick_lock(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_broadcast_tick_lock(text) TO service_role;