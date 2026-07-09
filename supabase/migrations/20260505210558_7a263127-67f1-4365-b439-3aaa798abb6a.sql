
alter table public.teams add column brand_id uuid references public.brands(id) on delete cascade;
alter table public.teams add column round_robin_enabled boolean not null default false;
alter table public.teams add column offhours_message text;
alter table public.teams drop constraint if exists teams_type_key;

-- Drop FK de brands -> teams ANTES do backfill para podermos remover os teams antigos
alter table public.brands drop constraint if exists brands_default_team_id_fkey;

do $$
declare
  b record;
  new_suporte uuid;
  new_vendas uuid;
  old_team_id uuid;
  old_team_type text;
begin
  for b in select id, name, default_team_id from public.brands loop
    insert into public.teams (brand_id, type, name) values (b.id, 'suporte', b.name || ' – Suporte') returning id into new_suporte;
    insert into public.teams (brand_id, type, name) values (b.id, 'vendas', b.name || ' – Vendas') returning id into new_vendas;

    old_team_id := b.default_team_id;
    select type::text into old_team_type from public.teams where id = old_team_id;
    update public.conversations
      set team_id = case when old_team_type = 'vendas' then new_vendas else new_suporte end
      where brand_id = b.id and team_id = old_team_id;
  end loop;
end $$;

delete from public.teams where brand_id is null;
alter table public.teams alter column brand_id set not null;
alter table public.teams add constraint teams_brand_type_unique unique (brand_id, type);

alter table public.brands drop column if exists default_team_id;
alter table public.brands drop column if exists round_robin_enabled;
alter table public.brands drop column if exists support_offhours_message;
alter table public.brands drop column if exists support_business_hours;

drop table if exists public.round_robin_state cascade;
create table public.round_robin_state (
  team_id uuid primary key references public.teams(id) on delete cascade,
  last_assigned_user_id uuid,
  last_assigned_at timestamptz
);
alter table public.round_robin_state enable row level security;
create policy "rr_state_admin" on public.round_robin_state for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop function if exists public.pick_next_agent(uuid, uuid);
create or replace function public.pick_next_agent(_team_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare _last uuid; _next uuid;
begin
  select last_assigned_user_id into _last from public.round_robin_state where team_id = _team_id;

  with candidates as (
    select distinct p.id as user_id
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id and ur.role = 'agent'
    join public.agent_presence ap on ap.user_id = p.id and ap.status = 'online'
    join public.agent_teams at on at.user_id = p.id and at.team_id = _team_id
    where p.active = true order by p.id
  )
  select user_id into _next from candidates
  where _last is null or user_id > _last order by user_id limit 1;

  if _next is null then
    select user_id into _next from (
      select distinct p.id as user_id
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id and ur.role = 'agent'
      join public.agent_presence ap on ap.user_id = p.id and ap.status = 'online'
      join public.agent_teams at on at.user_id = p.id and at.team_id = _team_id
      where p.active = true order by p.id
    ) c limit 1;
  end if;

  if _next is not null then
    insert into public.round_robin_state (team_id, last_assigned_user_id, last_assigned_at)
    values (_team_id, _next, now())
    on conflict (team_id) do update set last_assigned_user_id = excluded.last_assigned_user_id, last_assigned_at = now();
  end if;
  return _next;
end $$;

create or replace function public.has_brand_access(_user_id uuid, _brand_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.is_admin(_user_id)
    or exists (select 1 from public.agent_brands where user_id = _user_id and brand_id = _brand_id)
    or exists (
      select 1 from public.teams t
      join public.agent_teams at on at.team_id = t.id
      where t.brand_id = _brand_id and at.user_id = _user_id
    );
$$;

create or replace function public.create_default_brand_teams()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.teams (brand_id, type, name) values (new.id, 'suporte', new.name || ' – Suporte');
  insert into public.teams (brand_id, type, name) values (new.id, 'vendas', new.name || ' – Vendas');
  return new;
end $$;

drop trigger if exists trg_brand_create_teams on public.brands;
create trigger trg_brand_create_teams after insert on public.brands
for each row execute function public.create_default_brand_teams();
