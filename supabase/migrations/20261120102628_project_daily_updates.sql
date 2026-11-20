-- Published daily work reports are separate from the client discussion feed.
-- Existing comments, files, tasks and project membership remain unchanged.
create table public.project_daily_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  report_date date not null default ((clock_timestamp() at time zone 'Asia/Kolkata')::date),
  work_done text not null,
  next_steps text not null default '',
  blockers text not null default '',
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  constraint project_daily_updates_report_date_finite check (isfinite(report_date)),
  constraint project_daily_updates_work_done_check check (
    char_length(work_done) <= 10000 and regexp_replace(work_done, '[[:space:]]', '', 'g') <> ''
  ),
  constraint project_daily_updates_next_steps_check check (char_length(next_steps) <= 10000),
  constraint project_daily_updates_blockers_check check (char_length(blockers) <= 10000)
);

create index project_daily_updates_project_date_idx
  on public.project_daily_updates(project_id, report_date desc, created_at desc, id desc);

alter table public.project_daily_updates enable row level security;
revoke all on public.project_daily_updates from public, anon, authenticated;
grant select, insert on public.project_daily_updates to authenticated;
grant all on public.project_daily_updates to service_role;

create policy "view project daily updates" on public.project_daily_updates
  for select to authenticated using (public.can_view_project(project_id, auth.uid()));
create policy "editors publish project daily updates" on public.project_daily_updates
  for insert to authenticated with check (
    created_by = auth.uid() and public.can_edit_project(project_id, auth.uid())
  );

create function public.stamp_project_daily_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if auth.uid() is null then
      raise exception 'Authentication required' using errcode = '42501';
    end if;
    new.created_by := auth.uid();
    new.created_at := clock_timestamp();
  end if;
  if new.report_date > (clock_timestamp() at time zone 'Asia/Kolkata')::date then
    raise exception 'Daily updates cannot be dated in the future' using errcode = '22023';
  end if;
  new.work_done := btrim(new.work_done);
  new.next_steps := btrim(new.next_steps);
  new.blockers := btrim(new.blockers);
  return new;
end;
$$;
revoke all on function public.stamp_project_daily_update() from public, anon, authenticated;
create trigger stamp_project_daily_update before insert on public.project_daily_updates
  for each row execute function public.stamp_project_daily_update();

-- A global admin can report without project membership. Readers can still see
-- that report author's identity, scoped to projects they are allowed to view.
create policy "view visible daily update authors" on public.profiles
  for select to authenticated using (
    exists (
      select 1 from public.project_daily_updates u
      where u.created_by = profiles.id and public.can_view_project(u.project_id, auth.uid())
    )
  );
