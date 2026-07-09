
-- Fix search_path on remaining functions
create or replace function public.set_updated_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

-- Restrict EXECUTE on security definer helpers
revoke execute on function public.has_role(uuid, app_role) from public, anon;
revoke execute on function public.is_admin(uuid) from public, anon;
revoke execute on function public.is_in_team(uuid, uuid) from public, anon;
revoke execute on function public.has_brand_access(uuid, uuid) from public, anon;
revoke execute on function public.pick_next_agent(uuid, uuid) from public, anon;

grant execute on function public.has_role(uuid, app_role) to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_in_team(uuid, uuid) to authenticated;
grant execute on function public.has_brand_access(uuid, uuid) to authenticated;
-- pick_next_agent only used by service role / edge functions
grant execute on function public.pick_next_agent(uuid, uuid) to service_role;
