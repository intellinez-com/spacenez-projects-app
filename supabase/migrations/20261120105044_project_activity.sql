-- Immutable, server-recorded activity for client-visible project changes.
create table public.project_activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in (
    'task_created', 'task_updated', 'task_deleted', 'project_updated',
    'document_added', 'document_updated', 'document_removed', 'comment_added',
    'approval_requested', 'approval_approved', 'approval_changes_requested', 'team_note'
  )),
  occurred_at timestamptz not null default clock_timestamp(),
  source_type text not null check (source_type in ('tasks', 'projects', 'documents', 'comments', 'task_approvals', 'project_daily_updates')),
  source_id uuid not null,
  task_id uuid,
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object')
);
create index project_activity_project_time_idx on public.project_activity(project_id, occurred_at desc, id desc);
create index project_activity_actor_idx on public.project_activity(actor_id) where actor_id is not null;
alter table public.project_activity enable row level security;
revoke all on public.project_activity from public, anon, authenticated, service_role;
grant select on public.project_activity to authenticated, service_role;
create policy "view project activity" on public.project_activity for select to authenticated
  using (public.can_view_project(project_id, auth.uid()));

create table public.project_activity_tracking (
  id boolean primary key default true check (id),
  started_at timestamptz not null default clock_timestamp()
);
insert into public.project_activity_tracking(id) values (true);
alter table public.project_activity_tracking enable row level security;
revoke all on public.project_activity_tracking from public, anon, authenticated, service_role;
grant select on public.project_activity_tracking to authenticated, service_role;
create policy "view activity tracking start" on public.project_activity_tracking for select to authenticated using (true);

-- Only trigger invocation can write the event stream. This definer function
-- retains the original API role through current_setting('role'), while the
-- internal insert uses the owner's privileges; search_path is closed.
create function public.capture_project_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  previous_row jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) else '{}'::jsonb end;
  current_row jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) else to_jsonb(old) end;
  project_uuid uuid;
  source_uuid uuid := (current_row->>'id')::uuid;
  task_uuid uuid;
  actor uuid := auth.uid();
  event_kind text;
  event_payload jsonb := '{}'::jsonb;
  changes jsonb := '{}'::jsonb;
  field_name text;
  tracked_fields text[];
  api_write boolean := coalesce(current_setting('role', true), '') in ('authenticated', 'anon');
begin
  if tg_table_schema <> 'public' then raise exception 'Unsupported activity source'; end if;
  project_uuid := case when tg_table_name = 'projects' then source_uuid else (current_row->>'project_id')::uuid end;
  -- Cascading project deletion removes its stream. Child DELETE triggers must
  -- not attempt to insert another event referencing the already-deleted parent.
  if not exists (select 1 from public.projects where id = project_uuid) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_table_name = 'tasks' then
    task_uuid := source_uuid;
    event_payload := jsonb_build_object('title', current_row->>'title', 'status', current_row->'status', 'stage', current_row->'stage');
    if tg_op = 'INSERT' then event_kind := 'task_created';
    elsif tg_op = 'DELETE' then event_kind := 'task_deleted';
    else
      event_kind := 'task_updated';
      tracked_fields := array['title', 'description', 'status', 'stage', 'priority', 'assignee_id', 'start_date', 'due_date'];
    end if;
  elsif tg_table_name = 'projects' then
    event_kind := 'project_updated';
    event_payload := jsonb_build_object('name', current_row->>'name');
    tracked_fields := array['name', 'location', 'project_type', 'description', 'current_stage', 'status', 'start_date', 'target_date'];
  elsif tg_table_name = 'documents' then
    task_uuid := (current_row->>'task_id')::uuid;
    event_payload := jsonb_build_object('name', current_row->>'name', 'path', current_row->>'path', 'size', current_row->'size');
    if tg_op = 'INSERT' then event_kind := 'document_added';
    elsif tg_op = 'DELETE' then event_kind := 'document_removed';
    else
      event_kind := 'document_updated';
      tracked_fields := array['name', 'path', 'size', 'task_id'];
    end if;
  elsif tg_table_name = 'comments' then
    event_kind := 'comment_added';
    task_uuid := (current_row->>'task_id')::uuid;
    event_payload := jsonb_build_object('body', current_row->>'body', 'task_title',
      (select title from public.tasks where id = task_uuid and project_id = project_uuid));
  elsif tg_table_name = 'task_approvals' then
    task_uuid := (current_row->>'task_id')::uuid;
    if tg_op = 'INSERT' then event_kind := 'approval_requested';
    elsif previous_row->'state' is not distinct from current_row->'state' then return new;
    elsif current_row->>'state' = 'approved' then event_kind := 'approval_approved';
    elsif current_row->>'state' = 'changes_requested' then event_kind := 'approval_changes_requested';
    else return new;
    end if;
    event_payload := jsonb_build_object('task_title', current_row#>>'{snapshot,task,title}', 'revision', current_row->'revision', 'feedback', current_row->'feedback');
  elsif tg_table_name = 'project_daily_updates' then
    event_kind := 'team_note';
    event_payload := jsonb_build_object('work_done', current_row->>'work_done', 'next_steps', current_row->>'next_steps', 'blockers', current_row->>'blockers', 'report_date', current_row->>'report_date');
  else raise exception 'Unsupported activity source';
  end if;

  if tracked_fields is not null then
    foreach field_name in array tracked_fields loop
      if previous_row->field_name is distinct from current_row->field_name then
        changes := changes || jsonb_build_object(field_name, jsonb_build_object('from', previous_row->field_name, 'to', current_row->field_name));
      end if;
    end loop;
    if changes = '{}'::jsonb then return new; end if;
    event_payload := event_payload || jsonb_build_object('changes', changes);
  end if;

  if api_write then
    if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
    if tg_table_name = 'comments' then
      if not public.can_view_project(project_uuid, actor) or (current_row->>'user_id')::uuid <> actor then
        raise exception 'Project comment access required' using errcode = '42501';
      end if;
    elsif tg_table_name = 'task_approvals' and tg_op = 'UPDATE' then
      if (current_row->>'decided_by')::uuid is distinct from actor or not exists (
        select 1 from public.project_members where project_id = project_uuid and user_id = actor and access = 'client'
      ) then raise exception 'Project client access required' using errcode = '42501'; end if;
    elsif not public.can_edit_project(project_uuid, actor) then
      raise exception 'Project editor access required' using errcode = '42501';
    end if;
    if tg_table_name = 'task_approvals' and tg_op = 'INSERT' and (current_row->>'requested_by')::uuid is distinct from actor then
      raise exception 'Approval requester must match the actor' using errcode = '42501';
    end if;
  end if;
  insert into public.project_activity(project_id, actor_id, kind, source_type, source_id, task_id, payload)
    values (project_uuid, actor, event_kind, tg_table_name, source_uuid, task_uuid, event_payload);
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.capture_project_activity() from public, anon, authenticated, service_role;

create trigger capture_task_activity after insert or update or delete on public.tasks
  for each row execute function public.capture_project_activity();
create trigger capture_project_activity after update on public.projects
  for each row execute function public.capture_project_activity();
create trigger capture_document_activity after insert or update or delete on public.documents
  for each row execute function public.capture_project_activity();
create trigger capture_comment_activity after insert on public.comments
  for each row execute function public.capture_project_activity();
create trigger capture_approval_activity after insert or update on public.task_approvals
  for each row execute function public.capture_project_activity();
create trigger capture_team_note_activity after insert on public.project_daily_updates
  for each row execute function public.capture_project_activity();

create policy "view visible activity actors" on public.profiles for select to authenticated using (
  exists (select 1 from public.project_activity a where a.actor_id = profiles.id and public.can_view_project(a.project_id, auth.uid()))
);

-- Recover only events whose timestamp is recorded on the original source.
-- Task completion/status history cannot be reconstructed from updated_at.
insert into public.project_activity(project_id, actor_id, kind, occurred_at, source_type, source_id, task_id, payload)
  select project_id, uploaded_by, 'document_added', created_at, 'documents', id, task_id,
    jsonb_build_object('name', name, 'path', path, 'size', size, 'historical', true)
  from public.documents where isfinite(created_at) and created_at <= clock_timestamp();
insert into public.project_activity(project_id, actor_id, kind, occurred_at, source_type, source_id, task_id, payload)
  select c.project_id, c.user_id, 'comment_added', c.created_at, 'comments', c.id, c.task_id,
    jsonb_build_object('body', c.body, 'task_title', t.title, 'historical', true)
  from public.comments c left join public.tasks t on t.id = c.task_id and t.project_id = c.project_id
  where isfinite(c.created_at) and c.created_at <= clock_timestamp();
insert into public.project_activity(project_id, actor_id, kind, occurred_at, source_type, source_id, task_id, payload)
  select project_id, requested_by, 'approval_requested', requested_at, 'task_approvals', id, task_id,
    jsonb_build_object('task_title', snapshot#>>'{task,title}', 'revision', revision, 'historical', true)
  from public.task_approvals where isfinite(requested_at) and requested_at <= clock_timestamp();
insert into public.project_activity(project_id, actor_id, kind, occurred_at, source_type, source_id, task_id, payload)
  select project_id, decided_by, case when state = 'approved' then 'approval_approved' else 'approval_changes_requested' end,
    decided_at, 'task_approvals', id, task_id,
    jsonb_build_object('task_title', snapshot#>>'{task,title}', 'revision', revision, 'feedback', feedback, 'historical', true)
  from public.task_approvals where state <> 'pending' and decided_at is not null and isfinite(decided_at) and decided_at <= clock_timestamp();
insert into public.project_activity(project_id, actor_id, kind, occurred_at, source_type, source_id, payload)
  select project_id, created_by, 'team_note', created_at, 'project_daily_updates', id,
    jsonb_build_object('work_done', work_done, 'next_steps', next_steps, 'blockers', blockers, 'report_date', report_date, 'historical', true)
  from public.project_daily_updates where isfinite(created_at) and created_at <= clock_timestamp();
