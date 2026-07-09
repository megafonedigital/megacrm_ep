create or replace function public.enforce_account_limits_within_global()
returns trigger language plpgsql
security definer
set search_path = public
as $$
declare
  g_rpm int;
  g_burst int;
begin
  select global_rate_limit_per_minute, global_burst
    into g_rpm, g_burst
  from public.integration_global_limits where id = true;

  if g_rpm is not null and new.rate_limit_per_minute > g_rpm then
    raise exception 'rate_limit_per_minute (%) excede o teto da faixa global (%).', new.rate_limit_per_minute, g_rpm;
  end if;
  if g_burst is not null and new.rate_limit_burst > g_burst then
    raise exception 'rate_limit_burst (%) excede o teto da faixa global (%).', new.rate_limit_burst, g_burst;
  end if;
  return new;
end $$;

drop trigger if exists trg_account_limits_within_global on public.integration_accounts;
create trigger trg_account_limits_within_global
before insert or update of rate_limit_per_minute, rate_limit_burst
on public.integration_accounts
for each row execute function public.enforce_account_limits_within_global();