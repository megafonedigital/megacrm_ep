
create table public.brand_secrets (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  system_user_token text not null,
  updated_at timestamptz not null default now()
);
alter table public.brand_secrets enable row level security;
-- nenhuma policy → somente service_role acessa

alter table public.brands drop column if exists token_secret_id;
