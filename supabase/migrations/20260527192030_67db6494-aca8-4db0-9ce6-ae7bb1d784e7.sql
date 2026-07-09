
REVOKE EXECUTE ON FUNCTION public.claim_next_import_batch(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_next_pending_import() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_import_batch(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_next_pending_import() TO service_role;
