
REVOKE EXECUTE ON FUNCTION public.expire_stale_waiting_button_runs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_waiting_button_runs() TO service_role;
