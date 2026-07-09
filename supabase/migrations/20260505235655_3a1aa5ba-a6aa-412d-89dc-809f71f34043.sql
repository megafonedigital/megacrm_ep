alter table public.profiles add column if not exists phone text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_roles_user_id_role_key'
  ) then
    alter table public.user_roles add constraint user_roles_user_id_role_key unique (user_id, role);
  end if;
end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(new.email) not like '%@megafone.digital' then
    raise exception 'Cadastro restrito ao domínio @megafone.digital';
  end if;

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
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();