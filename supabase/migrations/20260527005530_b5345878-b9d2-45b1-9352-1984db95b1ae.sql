
-- 1) Conceder admin ao FCA (estava só em brand_members antes)
INSERT INTO public.user_roles (user_id, role)
VALUES ('9c49dafa-7af4-4bf8-8d12-7417e6291408'::uuid, 'admin'::app_role)
ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

-- 2) Ajustar handle_new_user: agora UNIQUE é em (user_id), não (user_id, role)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, full_name, email, avatar_url, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email,'@',1)),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'agent')
  on conflict (user_id) do nothing;

  return new;
end $function$;
