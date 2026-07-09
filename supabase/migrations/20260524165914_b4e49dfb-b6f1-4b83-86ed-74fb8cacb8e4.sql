create type broadcast_status as enum ('draft','scheduled','running','completed','cancelled','failed');
create type broadcast_target_status as enum ('pending','dispatched','failed','skipped','cancelled');

create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  automation_id uuid not null,
  name text not null,
  status broadcast_status not null default 'draft',
  audience_filter jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  send_window_start time,
  send_window_end time,
  rate_per_minute int not null default 60,
  channel_daily_tier int not null default 1000,
  total_targets int not null default 0,
  dispatched_count int not null default 0,
  failed_count int not null default 0,
  skipped_count int not null default 0,
  skip_no_window boolean not null default true,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index broadcasts_brand_status_idx on public.broadcasts (brand_id, status);
create index broadcasts_scheduled_idx on public.broadcasts (status, scheduled_at);

create table public.broadcast_targets (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  contact_id uuid not null,
  status broadcast_target_status not null default 'pending',
  run_id uuid,
  error text,
  dispatched_at timestamptz,
  created_at timestamptz not null default now()
);

create index broadcast_targets_status_idx on public.broadcast_targets (broadcast_id, status);

create trigger broadcasts_updated_at
before update on public.broadcasts
for each row execute function public.set_updated_at();

alter table public.broadcasts enable row level security;
alter table public.broadcast_targets enable row level security;

create policy broadcasts_select_member on public.broadcasts
for select to authenticated
using (has_brand_access(auth.uid(), brand_id));

create policy broadcasts_admin_all on public.broadcasts
for all to authenticated
using (is_admin(auth.uid()))
with check (is_admin(auth.uid()));

create policy broadcasts_supervisor_all on public.broadcasts
for all to authenticated
using (has_brand_access(auth.uid(), brand_id) and (has_role(auth.uid(), 'supervisor'::app_role) or has_role(auth.uid(), 'developer'::app_role)))
with check (has_brand_access(auth.uid(), brand_id) and (has_role(auth.uid(), 'supervisor'::app_role) or has_role(auth.uid(), 'developer'::app_role)));

create policy broadcast_targets_select_member on public.broadcast_targets
for select to authenticated
using (exists (select 1 from public.broadcasts b where b.id = broadcast_targets.broadcast_id and has_brand_access(auth.uid(), b.brand_id)));

create policy broadcast_targets_admin_all on public.broadcast_targets
for all to authenticated
using (is_admin(auth.uid()))
with check (is_admin(auth.uid()));

create policy broadcast_targets_supervisor_all on public.broadcast_targets
for all to authenticated
using (exists (select 1 from public.broadcasts b where b.id = broadcast_targets.broadcast_id and has_brand_access(auth.uid(), b.brand_id) and (has_role(auth.uid(), 'supervisor'::app_role) or has_role(auth.uid(), 'developer'::app_role))))
with check (exists (select 1 from public.broadcasts b where b.id = broadcast_targets.broadcast_id and has_brand_access(auth.uid(), b.brand_id) and (has_role(auth.uid(), 'supervisor'::app_role) or has_role(auth.uid(), 'developer'::app_role))));