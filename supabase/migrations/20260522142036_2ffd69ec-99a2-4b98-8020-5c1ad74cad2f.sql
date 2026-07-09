
-- Limites globais singleton
create table if not exists public.integration_global_limits (
  id boolean primary key default true check (id),
  tier text not null default 'equilibrado'
    check (tier in ('conservador','equilibrado','alto','intenso','custom')),
  global_rate_limit_per_minute int not null default 300
    check (global_rate_limit_per_minute between 30 and 3000),
  global_burst int not null default 60
    check (global_burst between 10 and 500),
  min_share_per_account int not null default 10
    check (min_share_per_account between 1 and 200),
  distribution_mode text not null default 'equal'
    check (distribution_mode in ('equal','weighted')),
  auto_throttle_until timestamptz,
  auto_throttle_tier text,
  updated_at timestamptz not null default now()
);
insert into public.integration_global_limits(id) values(true) on conflict do nothing;
alter table public.integration_global_limits enable row level security;

drop policy if exists "igl_admin_all" on public.integration_global_limits;
create policy "igl_admin_all" on public.integration_global_limits
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists "igl_select_supervisor_dev" on public.integration_global_limits;
create policy "igl_select_supervisor_dev" on public.integration_global_limits
  for select to authenticated
  using (public.has_role(auth.uid(), 'supervisor'::app_role) or public.has_role(auth.uid(), 'developer'::app_role));

-- Snapshots de saúde por minuto
create table if not exists public.integration_queue_health_snapshots (
  taken_at timestamptz primary key default date_trunc('minute', now()),
  pending int not null default 0,
  processing int not null default 0,
  processed_last_min int not null default 0,
  failed_last_min int not null default 0,
  tier text,
  level text not null default 'ok' check (level in ('ok','warn','critical')),
  reasons jsonb not null default '[]'::jsonb
);
alter table public.integration_queue_health_snapshots enable row level security;

drop policy if exists "iqhs_admin_select" on public.integration_queue_health_snapshots;
create policy "iqhs_admin_select" on public.integration_queue_health_snapshots
  for select to authenticated
  using (public.is_admin(auth.uid()) or public.has_role(auth.uid(), 'supervisor'::app_role) or public.has_role(auth.uid(), 'developer'::app_role));

create index if not exists iqhs_taken_at_idx on public.integration_queue_health_snapshots (taken_at desc);
