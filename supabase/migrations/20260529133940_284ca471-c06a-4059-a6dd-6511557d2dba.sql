-- Drop the previous search_contacts RPC (was timing out on large workspaces)
drop function if exists public.search_contacts(uuid, text, uuid, boolean, text, text, text, text, text[], text, text, int, int);

-- Indexes to make tag-filtered queries fast
create index if not exists idx_contact_tags_tag_id     on public.contact_tags(tag_id);
create index if not exists idx_contact_tags_contact_id on public.contact_tags(contact_id);
create index if not exists idx_contacts_brand_name     on public.contacts(brand_id, name);
create index if not exists idx_contacts_brand_created  on public.contacts(brand_id, created_at desc);

-- New RPC: tag-filtered contacts page (with optional search + sort + total count)
create or replace function public.search_contacts_by_tag(
  _brand_id  uuid,
  _tag_id    uuid,
  _search    text default null,
  _sort_by   text default 'name',
  _sort_dir  text default 'asc',
  _limit     int  default 25,
  _offset    int  default 0
) returns table (
  id uuid,
  brand_id uuid,
  name text,
  profile_name text,
  phone text,
  wa_id text,
  email text,
  created_at timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select c.*
      from public.contacts c
      join public.contact_tags ct
        on ct.contact_id = c.id
       and ct.tag_id = _tag_id
     where c.brand_id = _brand_id
       and (
         _search is null or length(trim(_search)) = 0
         or c.name         ilike '%'||_search||'%'
         or c.profile_name ilike '%'||_search||'%'
         or c.phone        ilike '%'||_search||'%'
         or c.wa_id        ilike '%'||_search||'%'
       )
  )
  select id, brand_id, name, profile_name, phone, wa_id,
         (metadata->>'email') as email,
         created_at,
         count(*) over () as total_count
    from filtered
   order by
     case when _sort_by = 'created_at' and lower(_sort_dir) = 'desc' then created_at end desc nulls last,
     case when _sort_by = 'created_at' and lower(_sort_dir) = 'asc'  then created_at end asc  nulls last,
     case when _sort_by <> 'created_at' and lower(_sort_dir) = 'desc' then coalesce(name, profile_name) end desc nulls last,
     case when _sort_by <> 'created_at' and lower(_sort_dir) = 'asc'  then coalesce(name, profile_name) end asc  nulls last,
     id asc
   limit greatest(least(coalesce(_limit, 25), 500), 1)
  offset greatest(coalesce(_offset, 0), 0);
$$;

grant execute on function public.search_contacts_by_tag(uuid, uuid, text, text, text, int, int)
  to authenticated, service_role;