
-- ============================================================
-- SPRINT 1 — CRM WhatsApp Multi-Marca — Schema completo
-- ============================================================

-- Extensions
create extension if not exists pgcrypto;
create extension if not exists pg_net;
create extension if not exists pg_cron;
-- vault is enabled by default in Supabase; safe to skip create

-- ============================================================
-- ENUMS
-- ============================================================
do $$ begin create type public.app_role as enum ('admin','supervisor','agent'); exception when duplicate_object then null; end $$;
do $$ begin create type public.team_type as enum ('suporte','vendas'); exception when duplicate_object then null; end $$;
do $$ begin create type public.conversation_status as enum ('aberto','pendente','resolvido'); exception when duplicate_object then null; end $$;
do $$ begin create type public.message_status as enum ('queued','sent','delivered','read','failed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.message_direction as enum ('inbound','outbound'); exception when duplicate_object then null; end $$;
do $$ begin create type public.message_type as enum ('text','image','audio','video','document','template','sticker','location','contacts','interactive','reaction','system'); exception when duplicate_object then null; end $$;
do $$ begin create type public.error_severity as enum ('info','warning','error','critical'); exception when duplicate_object then null; end $$;
do $$ begin create type public.presence_status as enum ('online','away','offline'); exception when duplicate_object then null; end $$;

-- ============================================================
-- TABLES: profiles, roles, teams
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  type team_type not null unique,
  name text not null,
  created_at timestamptz not null default now()
);
insert into public.teams (type, name) values ('suporte','Suporte'), ('vendas','Vendas');

create table public.agent_teams (
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  primary key (user_id, team_id)
);

-- ============================================================
-- BRANDS
-- ============================================================
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  default_team_id uuid not null references public.teams(id),
  phone_number text,
  phone_number_id text,
  waba_id text,
  business_id text,
  token_secret_id uuid, -- references vault.secrets(id) — fk omitted (vault schema)
  token_valid boolean not null default false,
  token_last_validated_at timestamptz,
  token_last_error text,
  round_robin_enabled boolean not null default false,
  support_business_hours jsonb, -- { mon: {start:'09:00', end:'18:00'}, ... }
  support_offhours_message text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agent_brands (
  user_id uuid not null references auth.users(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  primary key (user_id, brand_id)
);

-- ============================================================
-- CONTACTS, CONVERSATIONS
-- ============================================================
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  wa_id text not null,         -- WhatsApp ID (phone in international format)
  phone text,
  name text,
  profile_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, wa_id)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  team_id uuid not null references public.teams(id),
  assigned_to uuid references auth.users(id) on delete set null,
  status conversation_status not null default 'aberto',
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  window_expires_at timestamptz, -- last_inbound_at + 24h
  unread_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_conversations_brand on public.conversations(brand_id);
create index idx_conversations_team on public.conversations(team_id);
create index idx_conversations_assigned on public.conversations(assigned_to);
create index idx_conversations_status on public.conversations(status);
create index idx_conversations_last_message on public.conversations(last_message_at desc);

create table public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  event_type text not null, -- 'assigned'|'unassigned'|'status_changed'|'note_added'|'window_expired'
  actor_id uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_conv_events_conv on public.conversation_events(conversation_id, created_at desc);

-- ============================================================
-- MESSAGES, NOTES
-- ============================================================
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  direction message_direction not null,
  type message_type not null,
  content text,                  -- texto livre / caption
  media_url text,                -- URL no Storage
  media_mime text,
  media_filename text,
  media_size_bytes integer,
  wa_message_id text unique,     -- id retornado pela Meta
  status message_status not null default 'queued',
  error_code text,
  error_message text,
  template_name text,
  template_language text,
  template_variables jsonb,
  reply_to_wa_id text,
  sent_by uuid references auth.users(id) on delete set null,
  raw jsonb,                     -- payload original (debug)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_messages_conv on public.messages(conversation_id, created_at);
create index idx_messages_brand on public.messages(brand_id);
create index idx_messages_status on public.messages(status);

create table public.internal_notes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index idx_notes_conv on public.internal_notes(conversation_id, created_at);

-- ============================================================
-- TEMPLATES
-- ============================================================
create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  meta_template_id text,
  name text not null,
  language text not null,
  category text,
  status text not null default 'PENDING', -- APPROVED, PENDING, REJECTED
  components jsonb not null default '[]'::jsonb,
  variables_count integer not null default 0,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (brand_id, name, language)
);

-- ============================================================
-- WEBHOOKS RAW + ERROR LOGS
-- ============================================================
create table public.webhook_events_raw (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands(id) on delete set null,
  payload jsonb not null,
  signature text,
  received_at timestamptz not null default now(),
  processed boolean not null default false,
  processed_at timestamptz,
  attempts integer not null default 0,
  last_error text
);
create index idx_webhook_unprocessed on public.webhook_events_raw(processed, received_at) where processed = false;

create table public.error_logs (
  id uuid primary key default gen_random_uuid(),
  severity error_severity not null,
  category text not null,        -- meta_api | webhook | auth | validation | internal | media
  code text not null,            -- ex: META_TOKEN_INVALID
  message_pt text not null,
  technical_message text,
  brand_id uuid references public.brands(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  payload jsonb,
  acknowledged boolean not null default false,
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_error_logs_unack on public.error_logs(acknowledged, severity, created_at desc);
create index idx_error_logs_brand on public.error_logs(brand_id, created_at desc);

-- ============================================================
-- PRESENCE + ROUND ROBIN
-- ============================================================
create table public.agent_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status presence_status not null default 'offline',
  last_seen_at timestamptz not null default now()
);

create table public.round_robin_state (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  last_assigned_user_id uuid references auth.users(id) on delete set null,
  last_assigned_at timestamptz
);

-- ============================================================
-- SECURITY DEFINER HELPER FUNCTIONS
-- ============================================================
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;

create or replace function public.is_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = 'admin');
$$;

create or replace function public.is_in_team(_user_id uuid, _team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.agent_teams where user_id = _user_id and team_id = _team_id);
$$;

create or replace function public.has_brand_access(_user_id uuid, _brand_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.is_admin(_user_id)
    or exists (select 1 from public.agent_brands where user_id = _user_id and brand_id = _brand_id)
    or exists (
      select 1
      from public.brands b
      join public.agent_teams at on at.team_id = b.default_team_id
      where b.id = _brand_id and at.user_id = _user_id
    );
$$;

-- Trigger: auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email,'@',1)),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at trigger helper
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger trg_profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger trg_brands_updated before update on public.brands for each row execute function public.set_updated_at();
create trigger trg_contacts_updated before update on public.contacts for each row execute function public.set_updated_at();
create trigger trg_conversations_updated before update on public.conversations for each row execute function public.set_updated_at();
create trigger trg_messages_updated before update on public.messages for each row execute function public.set_updated_at();

-- ============================================================
-- ROUND ROBIN: pick next online agent for brand+team
-- ============================================================
create or replace function public.pick_next_agent(_brand_id uuid, _team_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  _last uuid;
  _next uuid;
begin
  select last_assigned_user_id into _last from public.round_robin_state where brand_id = _brand_id;

  -- candidates: agents with role 'agent', present 'online', linked to brand, in team
  with candidates as (
    select distinct p.id as user_id
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id and ur.role = 'agent'
    join public.agent_presence ap on ap.user_id = p.id and ap.status = 'online'
    join public.agent_teams at on at.user_id = p.id and at.team_id = _team_id
    left join public.agent_brands ab on ab.user_id = p.id and ab.brand_id = _brand_id
    where p.active = true
      and (ab.user_id is not null or true) -- allow team-only mapping; brand link optional
    order by p.id
  )
  select user_id into _next from candidates
  where _last is null or user_id > _last
  order by user_id limit 1;

  if _next is null then
    select user_id into _next from (
      select distinct p.id as user_id
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id and ur.role = 'agent'
      join public.agent_presence ap on ap.user_id = p.id and ap.status = 'online'
      join public.agent_teams at on at.user_id = p.id and at.team_id = _team_id
      where p.active = true
      order by p.id
    ) c limit 1;
  end if;

  if _next is not null then
    insert into public.round_robin_state (brand_id, last_assigned_user_id, last_assigned_at)
    values (_brand_id, _next, now())
    on conflict (brand_id) do update set last_assigned_user_id = excluded.last_assigned_user_id, last_assigned_at = now();
  end if;

  return _next;
end $$;

-- ============================================================
-- ENABLE RLS
-- ============================================================
alter table public.profiles            enable row level security;
alter table public.user_roles          enable row level security;
alter table public.teams               enable row level security;
alter table public.agent_teams         enable row level security;
alter table public.brands              enable row level security;
alter table public.agent_brands        enable row level security;
alter table public.contacts            enable row level security;
alter table public.conversations       enable row level security;
alter table public.conversation_events enable row level security;
alter table public.messages            enable row level security;
alter table public.internal_notes      enable row level security;
alter table public.whatsapp_templates  enable row level security;
alter table public.webhook_events_raw  enable row level security;
alter table public.error_logs          enable row level security;
alter table public.agent_presence      enable row level security;
alter table public.round_robin_state   enable row level security;

-- ============================================================
-- POLICIES
-- ============================================================
-- profiles
create policy "profiles_select_authenticated" on public.profiles for select to authenticated using (true);
create policy "profiles_update_self"          on public.profiles for update to authenticated using (id = auth.uid());
create policy "profiles_admin_all"            on public.profiles for all    to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- user_roles (admin only)
create policy "user_roles_admin_all"  on public.user_roles for all    to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "user_roles_select_self" on public.user_roles for select to authenticated using (user_id = auth.uid());

-- teams
create policy "teams_select_auth"  on public.teams for select to authenticated using (true);
create policy "teams_admin_all"    on public.teams for all    to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- agent_teams
create policy "agent_teams_select_auth" on public.agent_teams for select to authenticated using (user_id = auth.uid() or public.is_admin(auth.uid()));
create policy "agent_teams_admin_all"   on public.agent_teams for all    to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- brands
create policy "brands_admin_all"     on public.brands for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "brands_select_member" on public.brands for select to authenticated using (public.has_brand_access(auth.uid(), id));

-- agent_brands
create policy "agent_brands_admin_all" on public.agent_brands for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "agent_brands_select_self" on public.agent_brands for select to authenticated using (user_id = auth.uid());

-- contacts
create policy "contacts_select_brand" on public.contacts for select to authenticated using (public.has_brand_access(auth.uid(), brand_id));
create policy "contacts_insert_brand" on public.contacts for insert to authenticated with check (public.has_brand_access(auth.uid(), brand_id));
create policy "contacts_update_brand" on public.contacts for update to authenticated using (public.has_brand_access(auth.uid(), brand_id));

-- conversations
create policy "conversations_select" on public.conversations for select to authenticated using (
  public.is_admin(auth.uid())
  or (public.has_role(auth.uid(),'supervisor') and public.has_brand_access(auth.uid(), brand_id))
  or (public.has_brand_access(auth.uid(), brand_id) and (assigned_to = auth.uid() or assigned_to is null))
);
create policy "conversations_update" on public.conversations for update to authenticated using (
  public.is_admin(auth.uid())
  or (public.has_role(auth.uid(),'supervisor') and public.has_brand_access(auth.uid(), brand_id))
  or (public.has_brand_access(auth.uid(), brand_id) and (assigned_to = auth.uid() or assigned_to is null))
);
create policy "conversations_insert" on public.conversations for insert to authenticated with check (public.has_brand_access(auth.uid(), brand_id));

-- conversation_events
create policy "conv_events_select" on public.conversation_events for select to authenticated using (
  exists (select 1 from public.conversations c where c.id = conversation_id and (
    public.is_admin(auth.uid())
    or public.has_brand_access(auth.uid(), c.brand_id)
  ))
);
create policy "conv_events_insert" on public.conversation_events for insert to authenticated with check (
  exists (select 1 from public.conversations c where c.id = conversation_id and public.has_brand_access(auth.uid(), c.brand_id))
);

-- messages
create policy "messages_select" on public.messages for select to authenticated using (
  exists (select 1 from public.conversations c where c.id = conversation_id and (
    public.is_admin(auth.uid())
    or (public.has_role(auth.uid(),'supervisor') and public.has_brand_access(auth.uid(), c.brand_id))
    or (public.has_brand_access(auth.uid(), c.brand_id) and (c.assigned_to = auth.uid() or c.assigned_to is null))
  ))
);
-- inserts/updates from frontend são raros (envio é via Edge Function service role); permitimos para retry/notas técnicas
create policy "messages_insert_brand" on public.messages for insert to authenticated with check (public.has_brand_access(auth.uid(), brand_id));

-- internal_notes
create policy "notes_select" on public.internal_notes for select to authenticated using (
  exists (select 1 from public.conversations c where c.id = conversation_id and (
    public.is_admin(auth.uid())
    or public.has_brand_access(auth.uid(), c.brand_id)
  ))
);
create policy "notes_insert" on public.internal_notes for insert to authenticated with check (
  author_id = auth.uid() and exists (
    select 1 from public.conversations c where c.id = conversation_id and public.has_brand_access(auth.uid(), c.brand_id)
  )
);

-- templates
create policy "templates_select_brand" on public.whatsapp_templates for select to authenticated using (public.has_brand_access(auth.uid(), brand_id));
create policy "templates_admin_all"    on public.whatsapp_templates for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- webhook_events_raw: service role only (no policies = blocked)
-- (RLS habilitado, sem policy → ninguém autenticado lê/escreve)

-- error_logs
create policy "error_logs_admin_all" on public.error_logs for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "error_logs_supervisor_select" on public.error_logs for select to authenticated using (
  public.has_role(auth.uid(),'supervisor') and (brand_id is null or public.has_brand_access(auth.uid(), brand_id))
);

-- agent_presence
create policy "presence_select_auth" on public.agent_presence for select to authenticated using (true);
create policy "presence_upsert_self" on public.agent_presence for insert to authenticated with check (user_id = auth.uid());
create policy "presence_update_self" on public.agent_presence for update to authenticated using (user_id = auth.uid());

-- round_robin_state: service role only

-- ============================================================
-- REALTIME
-- ============================================================
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.internal_notes;
alter publication supabase_realtime add table public.error_logs;
alter publication supabase_realtime add table public.agent_presence;
alter publication supabase_realtime add table public.conversation_events;
