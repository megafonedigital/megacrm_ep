
REVOKE ALL ON FUNCTION public.inbox_overview(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inbox_overview(uuid, text, text) TO authenticated;
