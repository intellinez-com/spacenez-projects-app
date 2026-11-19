-- Apply after the existing drizzle 0000/0001 baseline. No source data is replaced.
alter table public.projects
  add column client_brand text,
  add column client_email text,
  add column meeting_url text,
  add constraint projects_meeting_url_calendly_check check (
    meeting_url is null or meeting_url ~* '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*calendly\.com/[^[:space:][:cntrl:]]+$'
  );

alter table public.tasks
  add column content_revision integer not null default 1 check (content_revision > 0),
  add column source_id text,
  add column source_metadata jsonb not null default '{}',
  add constraint tasks_id_project_id_key unique (id, project_id),
  add constraint tasks_project_source_key unique (project_id, source_id);

-- Attachments must belong to the same project as their task and storage path.
alter table public.documents
  add constraint documents_task_project_fkey foreign key (task_id, project_id)
    references public.tasks(id, project_id),
  add constraint documents_project_path_check check (
    split_part(path, '/', 1) = project_id::text and length(path) > 37
  );
alter table public.comments
  add constraint comments_task_project_fkey foreign key (task_id, project_id)
    references public.tasks(id, project_id);
create index comments_project_created_idx on public.comments(project_id, created_at desc);
create index tasks_project_position_idx on public.tasks(project_id, position);

create table public.task_approvals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  task_id uuid not null,
  revision integer not null check (revision > 0),
  state text not null default 'pending' check (state in ('pending', 'approved', 'changes_requested')),
  snapshot jsonb not null,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  requested_at timestamptz not null default clock_timestamp(),
  decided_by uuid references public.profiles(id) on delete restrict,
  decided_at timestamptz,
  feedback text,
  constraint task_approvals_task_project_fkey foreign key (task_id, project_id)
    references public.tasks(id, project_id) on delete restrict,
  constraint task_approvals_task_revision_key unique (task_id, revision),
  constraint task_approvals_decision_check check (
    (state = 'pending' and decided_by is null and decided_at is null and feedback is null)
    or (state <> 'pending' and decided_by is not null and decided_at is not null and decided_by <> requested_by)
  ),
  constraint task_approvals_feedback_check check (
    state <> 'changes_requested' or (feedback is not null and regexp_replace(feedback, '[[:space:]]', '', 'g') <> '')
  )
);
create index task_approvals_project_requested_idx on public.task_approvals(project_id, requested_at desc);
alter table public.task_approvals enable row level security;
revoke all on public.task_approvals from anon, authenticated;
grant select on public.task_approvals to authenticated;
grant all on public.task_approvals to service_role;
create policy "view task approvals" on public.task_approvals for select to authenticated
  using (public.can_view_project(project_id, auth.uid()));

-- Global admins can author project updates without being project members.
-- Show their identity only to readers of the project where they participated.
create policy "view visible project authors" on public.profiles for select to authenticated using (
  exists (select 1 from public.projects p where p.created_by = profiles.id and public.can_view_project(p.id, auth.uid()))
  or exists (select 1 from public.comments c where c.user_id = profiles.id and public.can_view_project(c.project_id, auth.uid()))
  or exists (select 1 from public.task_approvals a
    where (a.requested_by = profiles.id or a.decided_by = profiles.id) and public.can_view_project(a.project_id, auth.uid()))
);

-- Source planning rows are deliberately separate from real client decisions.
create table public.task_approval_plan (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null,
  source_id text not null,
  stage_gate text,
  milestone text,
  description text,
  source_metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint task_approval_plan_task_project_fkey foreign key (task_id, project_id)
    references public.tasks(id, project_id) on delete cascade,
  constraint task_approval_plan_project_source_key unique (project_id, source_id)
);
alter table public.task_approval_plan enable row level security;
revoke all on public.task_approval_plan from anon, authenticated;
grant select on public.task_approval_plan to authenticated;
grant all on public.task_approval_plan to service_role;
create policy "view task approval plan" on public.task_approval_plan for select to authenticated
  using (public.can_view_project(project_id, auth.uid()));

create table public.project_imports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  import_key text not null unique,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  imported_by uuid not null references public.profiles(id) on delete restrict,
  imported_at timestamptz not null default now(),
  task_count integer not null check (task_count >= 0),
  approval_plan_count integer not null check (approval_plan_count >= 0),
  client_linked boolean not null default false
);
alter table public.project_imports enable row level security;
revoke all on public.project_imports from anon, authenticated;
grant select on public.project_imports to authenticated;
grant all on public.project_imports to service_role;
create policy "admin view project imports" on public.project_imports for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create function public.track_task_content_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- SECURITY INVOKER retains the calling SQL role. The admin-only import RPC
  -- runs as its owner, while direct portal writes run as authenticated.
  if current_user in ('authenticated', 'anon') then
    if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
    if tg_op = 'INSERT' then
      if new.source_id is not null or new.source_metadata <> '{}'::jsonb then
        raise exception 'Source provenance can only be set by the project-plan import' using errcode = '42501';
      end if;
      new.created_by := auth.uid();
      new.created_at := clock_timestamp();
    elsif row(new.id, new.project_id, new.created_by, new.created_at, new.source_id, new.source_metadata)
      is distinct from row(old.id, old.project_id, old.created_by, old.created_at, old.source_id, old.source_metadata) then
      raise exception 'Task identity, attribution and source provenance cannot be changed' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.content_revision := 1;
  elsif row(new.title, new.description, new.stage) is distinct from row(old.title, old.description, old.stage) then
    new.content_revision := old.content_revision + 1;
    new.updated_at := clock_timestamp();
  elsif pg_trigger_depth() > 1 and new.content_revision = old.content_revision + 1 then
    -- Only nested document triggers may advance an otherwise unchanged task.
    new.updated_at := clock_timestamp();
  else
    new.content_revision := old.content_revision;
  end if;
  return new;
end;
$$;
revoke all on function public.track_task_content_revision() from public, anon, authenticated;
create trigger task_content_revision before insert or update on public.tasks
  for each row execute function public.track_task_content_revision();

-- Policy helper exposes only whether a visible project's file is retained.
create function public.approval_retains_file(p_document_id uuid, p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.task_approvals a
    cross join lateral jsonb_array_elements(a.snapshot->'documents') d
    where public.can_view_project(a.project_id, auth.uid()) and (
      (p_document_id is not null and d->>'id' = p_document_id::text)
      or (p_path is not null and d->>'path' = p_path)
    )
  )
$$;
revoke all on function public.approval_retains_file(uuid, text) from public, anon;
grant execute on function public.approval_retains_file(uuid, text) to authenticated;

create policy "retain approval document metadata" on public.documents as restrictive
  for delete to authenticated using (not public.approval_retains_file(id, path));
create policy "retain approval document metadata on update" on public.documents as restrictive
  for update to authenticated using (not public.approval_retains_file(id, path))
  with check (not public.approval_retains_file(id, path));

create function public.stamp_document_author()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
    new.uploaded_by := auth.uid();
    new.created_at := clock_timestamp();
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_document_author() from public, anon, authenticated;
create trigger stamp_document_author before insert on public.documents
  for each row execute function public.stamp_document_author();

create function public.track_task_document_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_task uuid;
  new_task uuid;
begin
  if tg_op <> 'INSERT' then old_task := old.task_id; end if;
  if tg_op <> 'DELETE' then new_task := new.task_id; end if;
  -- Match request_task_approval's lock. Recheck retention after waiting so a
  -- concurrent request cannot snapshot a file that is being removed.
  perform t.id from public.tasks t where t.id in (old_task, new_task) order by t.id for update;
  if tg_op <> 'INSERT' and exists (
    select 1 from public.task_approvals a
    cross join lateral jsonb_array_elements(a.snapshot->'documents') d
    where d->>'id' = old.id::text or d->>'path' = old.path
  ) then
    raise exception 'This document is retained in an approval snapshot' using errcode = '55000';
  end if;
  if tg_op <> 'UPDATE' or new is distinct from old then
    update public.tasks t set content_revision = t.content_revision + 1
      where t.id in (old_task, new_task);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.track_task_document_revision() from public, anon, authenticated;
create trigger task_document_revision before insert or update or delete on public.documents
  for each row execute function public.track_task_document_revision();

insert into storage.buckets(id, name, public, file_size_limit)
  values ('project-files', 'project-files', false, 52428800)
  on conflict (id) do nothing;
do $$ begin
  if exists (select 1 from storage.buckets where id = 'project-files' and public) then
    raise exception 'project-files must be private before enabling approvals';
  end if;
end $$;
create policy "retain approval files" on storage.objects as restrictive
  for delete to authenticated using (bucket_id <> 'project-files' or not public.approval_retains_file(null, name));
create policy "retain approval files on update" on storage.objects as restrictive
  for update to authenticated using (bucket_id <> 'project-files' or not public.approval_retains_file(null, name))
  with check (bucket_id <> 'project-files' or not public.approval_retains_file(null, name));

create function public.protect_approval_storage_file()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.bucket_id = 'project-files' then
    perform t.id from public.tasks t where exists (
      select 1 from public.documents d where d.task_id = t.id and d.path = old.name
    ) order by t.id for update;
    if exists (
      select 1 from public.task_approvals a
      cross join lateral jsonb_array_elements(a.snapshot->'documents') d
      where d->>'path' = old.name
    ) then
      raise exception 'This file is retained in an approval snapshot' using errcode = '55000';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.protect_approval_storage_file() from public, anon, authenticated;
create trigger protect_approval_file before update or delete on storage.objects
  for each row execute function public.protect_approval_storage_file();

create function public.request_task_approval(p_task_id uuid)
returns public.task_approvals language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  task_row public.tasks;
  approval_row public.task_approvals;
  document_snapshot jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into task_row from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  if not public.can_edit_project(task_row.project_id, actor) then
    raise exception 'Project editor access required' using errcode = '42501';
  end if;
  select * into approval_row from public.task_approvals where task_id = p_task_id and revision = task_row.content_revision;
  if found then return approval_row; end if;
  if exists (
    select 1 from public.documents d where d.task_id = p_task_id and not exists (
      select 1 from storage.objects o where o.bucket_id = 'project-files' and o.name = d.path
    )
  ) then
    raise exception 'Complete file uploads before requesting approval' using errcode = '23514';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'name', d.name, 'path', d.path, 'size', d.size,
    'created_at', d.created_at, 'uploaded_by', d.uploaded_by
  ) order by d.id), '[]'::jsonb) into document_snapshot
    from public.documents d where d.task_id = p_task_id and d.project_id = task_row.project_id;
  insert into public.task_approvals(project_id, task_id, revision, snapshot, requested_by)
    values (task_row.project_id, task_row.id, task_row.content_revision,
      jsonb_build_object('version', 1, 'task', jsonb_build_object(
        'id', task_row.id, 'title', task_row.title, 'description', task_row.description,
        'stage', task_row.stage, 'content_revision', task_row.content_revision
      ), 'documents', document_snapshot), actor)
    returning * into approval_row;
  return approval_row;
end;
$$;
revoke all on function public.request_task_approval(uuid) from public, anon;
grant execute on function public.request_task_approval(uuid) to authenticated;

create function public.respond_task_approval(p_approval_id uuid, p_decision text, p_feedback text default null)
returns public.task_approvals language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  task_row public.tasks;
  approval_row public.task_approvals;
  approval_task uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_decision is null or p_decision not in ('approved', 'changes_requested') then
    raise exception 'Choose approved or changes_requested' using errcode = '22023';
  end if;
  if p_decision = 'changes_requested' and (p_feedback is null or regexp_replace(p_feedback, '[[:space:]]', '', 'g') = '') then
    raise exception 'Explain the requested changes in your feedback' using errcode = '22023';
  end if;
  select task_id into approval_task from public.task_approvals where id = p_approval_id;
  if not found then raise exception 'Approval not found' using errcode = 'P0002'; end if;
  select * into task_row from public.tasks where id = approval_task for update;
  select * into approval_row from public.task_approvals where id = p_approval_id for update;
  if not exists (select 1 from public.project_members m
    where m.project_id = approval_row.project_id and m.user_id = actor and m.access = 'client') then
    raise exception 'Project client access required' using errcode = '42501';
  end if;
  if actor = approval_row.requested_by then
    raise exception 'The requester cannot decide their own approval' using errcode = '42501';
  end if;
  if approval_row.state <> 'pending' then
    raise exception 'This approval has already been decided' using errcode = '55000';
  end if;
  if approval_row.revision <> task_row.content_revision then
    raise exception 'The task changed; request approval of the current revision' using errcode = '55000';
  end if;
  update public.task_approvals set state = p_decision, decided_by = actor,
    decided_at = clock_timestamp(), feedback = nullif(btrim(p_feedback), '')
    where id = p_approval_id returning * into approval_row;
  return approval_row;
end;
$$;
revoke all on function public.respond_task_approval(uuid, text, text) from public, anon;
grant execute on function public.respond_task_approval(uuid, text, text) to authenticated;

create function public.import_project_plan(p_project jsonb, p_tasks jsonb, p_approval_plan jsonb, p_source_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  project_name text := nullif(btrim(p_project->>'name'), '');
  client_email text := nullif(btrim(p_project->>'client_email'), '');
  location_name text := nullif(btrim(p_project->>'location'), '');
  import_key_value text;
  previous_import public.project_imports;
  project_uuid uuid;
  client_uuid uuid;
  client_matches integer;
  task_uuid uuid;
  item jsonb;
  client_was_linked boolean := false;
begin
  if actor is null or not public.has_role(actor, 'admin') then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_project) is distinct from 'object' or project_name is null
    or jsonb_typeof(p_tasks) is distinct from 'array' or jsonb_array_length(p_tasks) = 0
    or jsonb_typeof(p_approval_plan) is distinct from 'array'
    or p_source_sha256 is null or p_source_sha256 !~* '^[0-9a-f]{64}$' then
    raise exception 'A project name, source SHA-256, task array and approval-plan array are required' using errcode = '22023';
  end if;
  import_key_value := md5(jsonb_build_array(lower(p_source_sha256),
    lower(regexp_replace(project_name, '[[:space:]]+', ' ', 'g')), lower(client_email),
    lower(regexp_replace(location_name, '[[:space:]]+', ' ', 'g')))::text);
  perform pg_advisory_xact_lock(hashtextextended(import_key_value, 0));
  select * into previous_import from public.project_imports where import_key = import_key_value;
  if found then
    return jsonb_build_object('project_id', previous_import.project_id, 'created', false,
      'task_count', previous_import.task_count, 'approval_plan_count', previous_import.approval_plan_count,
      'client_linked', previous_import.client_linked);
  end if;
  insert into public.projects(name, client_name, client_brand, client_email, location, project_type,
    description, start_date, target_date, meeting_url, created_by)
    values (project_name, nullif(btrim(p_project->>'client_name'), ''), nullif(btrim(p_project->>'client_brand'), ''),
      client_email, location_name, coalesce(nullif(btrim(p_project->>'project_type'), ''), 'Other'),
      p_project->>'description', nullif(p_project->>'start_date', '')::date,
      nullif(p_project->>'target_date', '')::date, nullif(btrim(p_project->>'meeting_url'), ''), actor)
    returning id into project_uuid;
  for item in select value from jsonb_array_elements(p_tasks) loop
    if jsonb_typeof(item) is distinct from 'object' or nullif(btrim(item->>'source_id'), '') is null
      or nullif(btrim(item->>'title'), '') is null
      or (item ? 'source_metadata' and jsonb_typeof(item->'source_metadata') is distinct from 'object') then
      raise exception 'Every source task needs a source_id, title and object metadata' using errcode = '22023';
    end if;
    insert into public.tasks(project_id, source_id, title, description, stage, status, priority,
      start_date, due_date, position, source_metadata, created_by)
      values (project_uuid, btrim(item->>'source_id'), item->>'title', item->>'description',
        coalesce(nullif(item->>'stage', ''), 'planning'), coalesce(nullif(item->>'status', ''), 'not_started'),
        coalesce(nullif(item->>'priority', ''), 'medium'), nullif(item->>'start_date', '')::date,
        nullif(item->>'due_date', '')::date, coalesce(nullif(item->>'position', '')::double precision, 0),
        coalesce(item->'source_metadata', '{}'::jsonb), actor);
  end loop;
  for item in select value from jsonb_array_elements(p_approval_plan) loop
    if jsonb_typeof(item) is distinct from 'object' or nullif(btrim(item->>'source_id'), '') is null
      or nullif(btrim(item->>'task_source_id'), '') is null
      or (item ? 'source_metadata' and jsonb_typeof(item->'source_metadata') is distinct from 'object') then
      raise exception 'Every planned approval needs source and task-source identifiers' using errcode = '22023';
    end if;
    select id into task_uuid from public.tasks where project_id = project_uuid and source_id = btrim(item->>'task_source_id');
    if not found then raise exception 'Planned approval references an unknown source task' using errcode = '23503'; end if;
    insert into public.task_approval_plan(project_id, task_id, source_id, stage_gate, milestone, description, source_metadata)
      values (project_uuid, task_uuid, btrim(item->>'source_id'), item->>'stage_gate', item->>'milestone',
        item->>'description', coalesce(item->'source_metadata', '{}'::jsonb));
  end loop;
  -- profiles.email is user-editable. Link only the verified Auth identity.
  select count(*), min(u.id::text)::uuid into client_matches, client_uuid
    from auth.users u join public.profiles p on p.id = u.id
    where client_email is not null and lower(btrim(u.email)) = lower(client_email) and u.email_confirmed_at is not null;
  if client_matches = 1 then
    insert into public.project_members(project_id, user_id, access) values (project_uuid, client_uuid, 'client');
    client_was_linked := true;
  end if;
  insert into public.project_imports(project_id, import_key, source_sha256, imported_by, task_count, approval_plan_count, client_linked)
    values (project_uuid, import_key_value, lower(p_source_sha256), actor,
      jsonb_array_length(p_tasks), jsonb_array_length(p_approval_plan), client_was_linked);
  return jsonb_build_object('project_id', project_uuid, 'created', true, 'task_count', jsonb_array_length(p_tasks),
    'approval_plan_count', jsonb_array_length(p_approval_plan), 'client_linked', client_was_linked);
end;
$$;
revoke all on function public.import_project_plan(jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.import_project_plan(jsonb, jsonb, jsonb, text) to authenticated;
