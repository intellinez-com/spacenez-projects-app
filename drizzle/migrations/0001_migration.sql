
create policy "pf read" on storage.objects for select to authenticated
  using (bucket_id = 'project-files' and public.can_view_project(((storage.foldername(name))[1])::uuid, auth.uid()));
create policy "pf upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files' and public.can_edit_project(((storage.foldername(name))[1])::uuid, auth.uid()));
create policy "pf delete" on storage.objects for delete to authenticated
  using (bucket_id = 'project-files' and public.can_edit_project(((storage.foldername(name))[1])::uuid, auth.uid()));
