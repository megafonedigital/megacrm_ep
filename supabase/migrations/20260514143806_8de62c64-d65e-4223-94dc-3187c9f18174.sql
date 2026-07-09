create or replace function public.api_logs_for_contact(_contact_id uuid)
returns table(id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c_phone text;
  c_wa_id text;
  c_email text;
  c_brand uuid;
  needles text[];
begin
  select phone, wa_id, coalesce(metadata->>'email',''), brand_id
    into c_phone, c_wa_id, c_email, c_brand
    from public.contacts where contacts.id = _contact_id;
  if not found then return; end if;
  if not (public.is_admin(auth.uid()) or public.has_brand_access(auth.uid(), c_brand)) then
    return;
  end if;
  needles := array_remove(array[nullif(c_phone,''), nullif(c_wa_id,''), nullif(c_email,'')], null);
  if array_length(needles, 1) is null then return; end if;
  return query
    select l.id from public.api_request_logs l
    where (l.brand_id is null or l.brand_id = c_brand)
      and exists (
        select 1 from unnest(needles) n
        where l.request_body::text ilike '%'||n||'%'
      )
    order by l.created_at desc
    limit 5000;
end $$;