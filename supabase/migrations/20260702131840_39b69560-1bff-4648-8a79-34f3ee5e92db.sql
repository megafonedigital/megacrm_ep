REVOKE EXECUTE ON FUNCTION public.admin_delete_contacts(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_delete_contacts(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_contacts(uuid[]) TO authenticated;