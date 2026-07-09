
-- Storage bucket for message media (private)
insert into storage.buckets (id, name, public, file_size_limit)
values ('message-media','message-media', false, 52428800)
on conflict (id) do nothing;

-- Path convention: {brand_id}/{conversation_id}/{filename}
create policy "media_select_brand" on storage.objects for select to authenticated using (
  bucket_id = 'message-media' and public.has_brand_access(auth.uid(), (split_part(name,'/',1))::uuid)
);
create policy "media_insert_brand" on storage.objects for insert to authenticated with check (
  bucket_id = 'message-media' and public.has_brand_access(auth.uid(), (split_part(name,'/',1))::uuid)
);
create policy "media_delete_admin" on storage.objects for delete to authenticated using (
  bucket_id = 'message-media' and public.is_admin(auth.uid())
);
