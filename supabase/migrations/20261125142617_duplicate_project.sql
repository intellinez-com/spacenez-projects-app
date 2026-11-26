-- A duplicate is a new plan, never a copy of the source client's work history.
create schema if not exists portal_duplication_private;
revoke all on schema portal_duplication_private from public, anon, authenticated;
grant usage on schema portal_duplication_private to authenticated;

create table portal_duplication_private.requests (
  request_id uuid primary key,
  actor_id uuid not null,
  source_project_id uuid not null,
  project_id uuid references public.projects(id) on delete set null,
  project_fields jsonb not null,
  task_count integer not null check (task_count >= 0),
  approval_plan_count integer not null check (approval_plan_count >= 0),
  stage_count integer not null check (stage_count > 0),
  created_at timestamptz not null default clock_timestamp()
);
alter table portal_duplication_private.requests enable row level security;
revoke all on portal_duplication_private.requests from public, anon, authenticated;

create function portal_duplication_private.duplicate_project(
  p_source_project_id uuid,
  p_request_id uuid,
  p_project jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  fields jsonb;
  previous portal_duplication_private.requests%rowtype;
  source_plan jsonb;
  new_project_id uuid := gen_random_uuid();
  new_task_id uuid;
  task_ids jsonb := '{}'::jsonb;
  item jsonb;
  first_stage text;
  copied_tasks integer := 0;
  copied_approvals integer := 0;
  copied_stages integer;
begin
  if actor is null or not public.has_role(actor, 'admin'::public.app_role) then
    raise exception 'Only admins can duplicate a project.' using errcode = '42501';
  end if;
  if p_source_project_id is null or p_request_id is null
     or p_project is null or jsonb_typeof(p_project) <> 'object' then
    raise exception 'A source, request ID and new project details are required.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_each(p_project) f
    where f.key not in ('name', 'client_name', 'client_brand', 'client_email', 'location', 'project_type', 'description')
      or jsonb_typeof(f.value) not in ('string', 'null')
  ) then
    raise exception 'Only the new project details may be supplied.' using errcode = '22023';
  end if;

  fields := jsonb_build_object(
    'name', btrim(coalesce(p_project->>'name', '')),
    'client_name', nullif(btrim(coalesce(p_project->>'client_name', '')), ''),
    'client_brand', nullif(btrim(coalesce(p_project->>'client_brand', '')), ''),
    'client_email', nullif(lower(btrim(coalesce(p_project->>'client_email', ''))), ''),
    'location', nullif(btrim(coalesce(p_project->>'location', '')), ''),
    'project_type', coalesce(nullif(btrim(p_project->>'project_type'), ''), 'Other'),
    'description', nullif(btrim(coalesce(p_project->>'description', '')), '')
  );
  if length(fields->>'name') not between 1 and 200
     or length(coalesce(fields->>'client_name', '')) > 200
     or length(coalesce(fields->>'client_brand', '')) > 200
     or length(coalesce(fields->>'client_email', '')) > 320
     or length(coalesce(fields->>'location', '')) > 500
     or length(coalesce(fields->>'description', '')) > 20000
     or fields->>'project_type' not in ('Apartment', 'Villa', 'Office', 'Retail', 'Restaurant / Café', 'Hospitality', 'Other')
     or (fields->>'client_email' is not null and fields->>'client_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Enter a new project name and valid project details.' using errcode = '22023';
  end if;

  -- A retry of an uncertain response must return the same project, even after
  -- either project has been edited. It must never clone the current source again.
  perform pg_advisory_xact_lock(hashtextextended('spacenez-duplicate:' || p_request_id::text, 0));
  select * into previous from portal_duplication_private.requests r where r.request_id = p_request_id;
  if found then
    if previous.actor_id <> actor or previous.source_project_id <> p_source_project_id then
      raise exception 'This duplication request belongs to another operation.' using errcode = '42501';
    end if;
    if previous.project_fields <> fields then
      raise exception 'This request already used different project details. Check Projects before starting another copy.' using errcode = '23505';
    end if;
    if previous.project_id is null then
      raise exception 'This copied project was removed. Start a new duplication request.' using errcode = '55000';
    end if;
    return jsonb_build_object(
      'project_id', previous.project_id, 'created', false,
      'task_count', previous.task_count, 'approval_plan_count', previous.approval_plan_count,
      'stage_count', previous.stage_count
    );
  end if;

  -- Headings changes lock this project too. Capture the complete task/review plan
  -- in one statement so concurrent task edits cannot yield a partially read plan.
  perform 1 from public.projects p where p.id = p_source_project_id for share;
  if not found or not public.can_view_project(p_source_project_id, actor) then
    raise exception 'Source project not found or access denied.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'stages', coalesce((select jsonb_agg(jsonb_build_object('key', s.key, 'label', s.label, 'position', s.position) order by s.position, s.key)
      from public.project_stages s where s.project_id = p_source_project_id and s.archived_at is null), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'description', t.description, 'stage', t.stage, 'priority', t.priority, 'position', t.position) order by t.position, t.id)
      from public.tasks t where t.project_id = p_source_project_id), '[]'::jsonb),
    'approvals', coalesce((select jsonb_agg(jsonb_build_object('task_id', a.task_id, 'stage_gate', a.stage_gate, 'milestone', a.milestone, 'description', a.description) order by a.created_at, a.id)
      from public.task_approval_plan a where a.project_id = p_source_project_id), '[]'::jsonb)
  ) into source_plan;
  copied_stages := jsonb_array_length(source_plan->'stages');
  if copied_stages = 0 or copied_stages > 100
     or jsonb_array_length(source_plan->'tasks') > 5000
     or jsonb_array_length(source_plan->'approvals') > 5000 then
    raise exception 'The source plan has no active headings or is too large to duplicate.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(source_plan->'tasks') t
    where not exists (select 1 from jsonb_array_elements(source_plan->'stages') s where s->>'key' = t->>'stage')
  ) then
    raise exception 'The source contains tasks outside its active headings. Refresh the source project before duplicating.' using errcode = '22023';
  end if;
  first_stage := source_plan->'stages'->0->>'key';

  -- No client identity, project dates, meeting link, progress or access is copied.
  insert into public.projects (
    id, name, client_name, client_brand, client_email, location, project_type,
    description, status, current_stage, start_date, target_date, meeting_url, created_by
  ) values (
    new_project_id, fields->>'name', fields->>'client_name', fields->>'client_brand', fields->>'client_email',
    fields->>'location', fields->>'project_type', fields->>'description', 'active', 'planning', null, null, null, actor
  );

  -- The project insert seeds standard headings. Replace only the new project's
  -- catalogue with the source's active plan; stable keys are scoped per project.
  delete from public.project_stages where project_id = new_project_id;
  insert into public.project_stages(project_id, key, label, position, archived_at)
    select new_project_id, s.key, s.label, s.position, null
    from jsonb_to_recordset(source_plan->'stages') s(key text, label text, position integer);
  update public.projects set current_stage = first_stage where id = new_project_id;

  for item in select value from jsonb_array_elements(source_plan->'tasks') loop
    new_task_id := gen_random_uuid();
    insert into public.tasks (
      id, project_id, title, description, stage, priority, position, status,
      assignee_id, start_date, due_date, created_by
    ) values (
      new_task_id, new_project_id, item->>'title', item->>'description', item->>'stage', item->>'priority',
      (item->>'position')::double precision, 'not_started', null, null, null, actor
    );
    task_ids := task_ids || jsonb_build_object(item->>'id', new_task_id);
    copied_tasks := copied_tasks + 1;
  end loop;
  for item in select value from jsonb_array_elements(source_plan->'approvals') loop
    if task_ids->>(item->>'task_id') is null then
      raise exception 'A source review has no task in the copied plan.' using errcode = '22023';
    end if;
    insert into public.task_approval_plan(project_id, task_id, source_id, stage_gate, milestone, description)
    values (
      new_project_id, (task_ids->>(item->>'task_id'))::uuid, 'duplicate-plan-' || gen_random_uuid()::text,
      item->>'stage_gate', item->>'milestone', item->>'description'
    );
    copied_approvals := copied_approvals + 1;
  end loop;

  insert into portal_duplication_private.requests (
    request_id, actor_id, source_project_id, project_id, project_fields,
    task_count, approval_plan_count, stage_count
  ) values (
    p_request_id, actor, p_source_project_id, new_project_id, fields,
    copied_tasks, copied_approvals, copied_stages
  );
  return jsonb_build_object(
    'project_id', new_project_id, 'created', true,
    'task_count', copied_tasks, 'approval_plan_count', copied_approvals, 'stage_count', copied_stages
  );
end;
$$;

revoke all on function portal_duplication_private.duplicate_project(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function portal_duplication_private.duplicate_project(uuid, uuid, jsonb) to authenticated;

create function public.duplicate_project(p_source_project_id uuid, p_request_id uuid, p_project jsonb)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select portal_duplication_private.duplicate_project(p_source_project_id, p_request_id, p_project);
$$;
revoke all on function public.duplicate_project(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.duplicate_project(uuid, uuid, jsonb) to authenticated;
