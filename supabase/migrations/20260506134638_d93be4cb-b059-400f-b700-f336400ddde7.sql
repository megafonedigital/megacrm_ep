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
  on conflict (user_id, role) do nothing;

  return new;
end $function$;