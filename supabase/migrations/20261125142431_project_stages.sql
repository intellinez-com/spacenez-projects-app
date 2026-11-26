-- Per-project headings retain stable keys. Labels/order are presentation;
-- removing a heading archives its identity after explicitly moving its tasks.
alter table public.projects add column stage_revision integer not null default 0 check (stage_revision >= 0);

create table public.project_stages (
  project_id uuid not null references public.projects(id) on delete cascade,
  key text not null,
  label text not null check (regexp_replace(label,'[[:space:]]','','g') <> '' and char_length(label) <= 120),
  position integer not null check (position >= 0),
  archived_at timestamptz,
  primary key (project_id, key)
);
create unique index project_stages_active_label_key on public.project_stages(project_id, lower(btrim(label))) where archived_at is null;
create index project_stages_project_order_idx on public.project_stages(project_id, position, key);
alter table public.project_stages enable row level security;
revoke all on public.project_stages from public, anon, authenticated, service_role;
grant select on public.project_stages to authenticated, service_role;
create policy "view project headings" on public.project_stages for select to authenticated using (public.can_view_project(project_id, auth.uid()));

create schema if not exists portal_stages_private;
revoke all on schema portal_stages_private from public, anon, authenticated, service_role;
grant usage on schema portal_stages_private to authenticated;

create function portal_stages_private.seed_project_stages(p_project_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  legacy_key text;
  legacy_label text;
  next_position integer;
begin
  insert into public.project_stages(project_id,key,label,position)
  select p_project_id,v.key,v.label,v.position from (values
    ('planning','Planning & Brief',0),('site_survey','Site Survey',1),
    ('layout_2d','2D Layout',2),('mood_boards','Mood Boards',3),
    ('design_3d','3D Visualisation',4),('interior_design','Interior Design & Materials',5),
    ('drawings','Working Drawings & BOQ',6),('approvals','Client Approvals',7),
    ('procurement','Procurement',8),('execution','Execution',9),('handover','Handover',10)
  ) v(key,label,position) on conflict (project_id,key) do nothing;
  -- Preserve every existing task/project key, including old custom imports.
  for legacy_key in
    select used.key from (
      select t.stage as key from public.tasks t where t.project_id=p_project_id
      union select p.current_stage from public.projects p where p.id=p_project_id
    ) used where not exists (select 1 from public.project_stages s where s.project_id=p_project_id and s.key=used.key)
    order by used.key
  loop
    legacy_label := left(coalesce(nullif(btrim(legacy_key),''),'Legacy heading'),120);
    if exists (select 1 from public.project_stages s where s.project_id=p_project_id and s.archived_at is null and lower(btrim(s.label))=lower(legacy_label)) then
      legacy_label := left(legacy_label,108)||' ['||substr(md5(legacy_key),1,8)||']';
    end if;
    select coalesce(max(s.position),-1)+1 into next_position from public.project_stages s where s.project_id=p_project_id;
    insert into public.project_stages(project_id,key,label,position) values(p_project_id,legacy_key,legacy_label,next_position);
  end loop;
end;
$$;
revoke all on function portal_stages_private.seed_project_stages(uuid) from public, anon, authenticated, service_role;

do $$ declare p record; begin
  for p in select id from public.projects loop
    perform portal_stages_private.seed_project_stages(p.id);
  end loop;
end $$;

create function portal_stages_private.seed_new_project_stages()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform portal_stages_private.seed_project_stages(new.id);
  return new;
end;
$$;
revoke all on function portal_stages_private.seed_new_project_stages() from public, anon, authenticated, service_role;
create trigger seed_project_stages after insert on public.projects for each row execute function portal_stages_private.seed_new_project_stages();

create function portal_stages_private.guard_task_stage()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- Match the structure RPC's parent lock so a concurrent insert cannot land in
  -- a heading between its task move and archive.
  perform p.id from public.projects p where p.id=new.project_id for update;
  if not exists(select 1 from public.project_stages s where s.project_id=new.project_id and s.key=new.stage and s.archived_at is null) then
    raise exception 'Choose an active project heading.' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function portal_stages_private.guard_task_stage() from public, anon, authenticated, service_role;
create trigger validate_task_stage before insert or update of stage,project_id on public.tasks for each row execute function portal_stages_private.guard_task_stage();

create function portal_stages_private.guard_project_stage()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op='INSERT' then
    if new.stage_revision<>0 then raise exception 'New projects start at heading revision zero.' using errcode='42501'; end if;
    return new;
  end if;
  if new.stage_revision is distinct from old.stage_revision and current_user in ('authenticated','anon') then
    raise exception 'Heading revisions are managed by the project structure action.' using errcode='42501';
  end if;
  if new.current_stage is distinct from old.current_stage and not exists(
    select 1 from public.project_stages s where s.project_id=new.id and s.key=new.current_stage and s.archived_at is null
  ) then
    raise exception 'Choose an active project heading.' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function portal_stages_private.guard_project_stage() from public, anon, authenticated, service_role;
create trigger validate_project_stage before insert or update of current_stage,stage_revision on public.projects for each row execute function portal_stages_private.guard_project_stage();

create table portal_stages_private.requests (
  project_id uuid not null references public.projects(id) on delete cascade,
  request_id uuid not null,
  actor_id uuid not null references public.profiles(id),
  expected_version integer not null,
  action jsonb not null,
  result jsonb not null,
  event jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(project_id,request_id)
);
revoke all on portal_stages_private.requests from public, anon, authenticated, service_role;

-- A single trigger-written activity per committed configuration action. Seed
-- rows and copied catalogues create no request rows and therefore no fake work.
create function portal_stages_private.capture_heading_action()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.project_activity(project_id,actor_id,kind,source_type,source_id,payload)
  select new.project_id,new.actor_id,'project_updated','projects',new.project_id,
    jsonb_build_object('name',p.name,'heading_change',new.event)
  from public.projects p where p.id=new.project_id;
  return new;
end;
$$;
revoke all on function portal_stages_private.capture_heading_action() from public, anon, authenticated, service_role;
create trigger capture_heading_action after insert on portal_stages_private.requests for each row execute function portal_stages_private.capture_heading_action();

create function portal_stages_private.mutate_project_stages(p_project_id uuid,p_expected_version integer,p_request_id uuid,p_action jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  project_row public.projects;
  previous portal_stages_private.requests;
  heading public.project_stages;
  destination public.project_stages;
  action_type text;
  heading_key text;
  heading_label text;
  active_count integer;
  moved_count integer := 0;
  keys text[];
  ordered_labels text[];
  event jsonb;
  result jsonb;
begin
  if actor is null or not public.has_role(actor,'admin') then
    raise exception 'Administrator access required.' using errcode='42501';
  end if;
  select * into project_row from public.projects p where p.id=p_project_id for update;
  if not found then raise exception 'Project not found or access denied.' using errcode='42501'; end if;
  if p_request_id is null or p_expected_version is null or p_expected_version<0 or jsonb_typeof(p_action) is distinct from 'object' then
    raise exception 'A request ID, heading version and action are required.' using errcode='22023';
  end if;
  select * into previous from portal_stages_private.requests r where r.project_id=p_project_id and r.request_id=p_request_id;
  if found then
    if previous.actor_id is distinct from actor or previous.expected_version is distinct from p_expected_version or previous.action is distinct from p_action then
      raise exception 'This request ID was already used for another action.' using errcode='23505';
    end if;
    return previous.result;
  end if;
  if project_row.stage_revision<>p_expected_version then
    raise exception 'Project headings changed. Refresh and try again.' using errcode='40001';
  end if;
  action_type:=p_action->>'type';
  if action_type is null or action_type not in ('add','rename','reorder','archive') then
    raise exception 'Choose a supported heading action.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_action) k where
    (action_type='add' and k not in ('type','label','key')) or
    (action_type='rename' and k not in ('type','key','label')) or
    (action_type='archive' and k not in ('type','key','move_to')) or
    (action_type='reorder' and k not in ('type','keys'))) then
    raise exception 'Unexpected heading action field.' using errcode='22023';
  end if;
  select count(*)::integer into active_count from public.project_stages s where s.project_id=p_project_id and s.archived_at is null;
  if action_type in ('add','rename') then
    if jsonb_typeof(p_action->'label') is distinct from 'string' then raise exception 'Enter a heading name.' using errcode='22023'; end if;
    heading_label:=btrim(p_action->>'label',E' \t\r\n');
    if regexp_replace(heading_label,'[[:space:]]','','g')='' or char_length(heading_label)>120 then raise exception 'Heading names must contain 1 to 120 characters.' using errcode='22023'; end if;
  end if;
  if action_type='add' then
    -- Keys are identities, never user-editable names. Accept an optional client
    -- generated key only in the same opaque namespace for stable optimistic UI.
    heading_key:=coalesce(p_action->>'key','custom_'||replace(gen_random_uuid()::text,'-',''));
    if heading_key!~'^custom_[0-9a-f]{32}$' then raise exception 'Invalid new heading key.' using errcode='22023'; end if;
    if exists(select 1 from public.project_stages s where s.project_id=p_project_id and s.archived_at is null and lower(btrim(s.label))=lower(heading_label)) then
      raise exception 'A heading with that name already exists.' using errcode='23505';
    end if;
    insert into public.project_stages(project_id,key,label,position)
      select p_project_id,heading_key,heading_label,coalesce(max(s.position),-1)+1 from public.project_stages s where s.project_id=p_project_id;
    event:=jsonb_build_object('type','added','key',heading_key,'label',heading_label);
  elsif action_type in ('rename','archive') then
    heading_key:=p_action->>'key';
    select * into heading from public.project_stages s where s.project_id=p_project_id and s.key=heading_key and s.archived_at is null;
    if not found then raise exception 'Choose an active project heading.' using errcode='22023'; end if;
    if action_type='rename' then
      if heading.label=heading_label then raise exception 'This heading already has that name.' using errcode='22023'; end if;
      if exists(select 1 from public.project_stages s where s.project_id=p_project_id and s.archived_at is null and s.key<>heading_key and lower(btrim(s.label))=lower(heading_label)) then
        raise exception 'A heading with that name already exists.' using errcode='23505';
      end if;
      update public.project_stages s set label=heading_label where s.project_id=p_project_id and s.key=heading_key;
      event:=jsonb_build_object('type','renamed','key',heading_key,'label',heading_label,'previous_label',heading.label);
    else
      if active_count<=1 then raise exception 'Keep at least one active project heading.' using errcode='22023'; end if;
      select count(*)::integer into moved_count from public.tasks t where t.project_id=p_project_id and t.stage=heading_key;
      if moved_count>0 or project_row.current_stage=heading_key or p_action ? 'move_to' then
        select * into destination from public.project_stages s where s.project_id=p_project_id and s.key=p_action->>'move_to' and s.key<>heading_key and s.archived_at is null;
        if not found then raise exception 'Choose another active heading to move work and the current project stage into.' using errcode='22023'; end if;
      end if;
      if moved_count>0 then update public.tasks t set stage=destination.key where t.project_id=p_project_id and t.stage=heading_key; end if;
      if project_row.current_stage=heading_key then update public.projects p set current_stage=destination.key where p.id=p_project_id; end if;
      update public.project_stages s set archived_at=clock_timestamp() where s.project_id=p_project_id and s.key=heading_key;
      event:=jsonb_build_object('type','removed','key',heading_key,'label',heading.label,'moved_tasks',moved_count,
        'move_to',destination.key,'move_to_label',destination.label);
    end if;
  else
    if jsonb_typeof(p_action->'keys') is distinct from 'array' or exists(select 1 from jsonb_array_elements(p_action->'keys') v where jsonb_typeof(v)<>'string') then
      raise exception 'Provide every active heading once in its new order.' using errcode='22023';
    end if;
    select array_agg(v.key order by v.ordinality) into keys from jsonb_array_elements_text(p_action->'keys') with ordinality v(key,ordinality);
    if coalesce(cardinality(keys),0)<>active_count or (select count(distinct k) from unnest(keys) k)<>active_count
      or exists(select 1 from unnest(keys) k where not exists(select 1 from public.project_stages s where s.project_id=p_project_id and s.key=k and s.archived_at is null)) then
      raise exception 'Provide every active heading once in its new order.' using errcode='22023';
    end if;
    if keys=(select array_agg(s.key order by s.position,s.key) from public.project_stages s where s.project_id=p_project_id and s.archived_at is null) then
      raise exception 'The heading order is unchanged.' using errcode='22023';
    end if;
    update public.project_stages s set position=(v.ordinality-1)::integer
      from unnest(keys) with ordinality v(key,ordinality) where s.project_id=p_project_id and s.key=v.key;
    select array_agg(s.label order by s.position,s.key) into ordered_labels from public.project_stages s where s.project_id=p_project_id and s.archived_at is null;
    event:=jsonb_build_object('type','reordered','order',to_jsonb(ordered_labels));
  end if;
  update public.projects p set stage_revision=p.stage_revision+1 where p.id=p_project_id returning p.stage_revision into project_row.stage_revision;
  result:=jsonb_build_object('version',project_row.stage_revision);
  if heading_key is not null then result:=result||jsonb_build_object('stage_key',heading_key); end if;
  insert into portal_stages_private.requests(project_id,request_id,actor_id,expected_version,action,result,event)
    values(p_project_id,p_request_id,actor,p_expected_version,p_action,result,event);
  return result;
end;
$$;
revoke all on function portal_stages_private.mutate_project_stages(uuid,integer,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function portal_stages_private.mutate_project_stages(uuid,integer,uuid,jsonb) to authenticated;

create function public.mutate_project_stages(p_project_id uuid,p_expected_version integer,p_request_id uuid,p_action jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select portal_stages_private.mutate_project_stages(p_project_id,p_expected_version,p_request_id,p_action);
$$;
revoke all on function public.mutate_project_stages(uuid,integer,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.mutate_project_stages(uuid,integer,uuid,jsonb) to authenticated;

-- New events and approval requests retain labels as they were when recorded.
-- Existing history/snapshots are deliberately never rewritten on heading rename.
create function portal_stages_private.snapshot_activity_stage_labels()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  stage_key text;
  from_key text;
  to_key text;
  stage_name text;
  from_name text;
  to_name text;
  changed_field text;
begin
  stage_key:=new.payload->>'stage';
  if stage_key is not null then
    select s.label into stage_name from public.project_stages s where s.project_id=new.project_id and s.key=stage_key;
    new.payload:=new.payload||jsonb_build_object('stage_label',coalesce(stage_name,stage_key));
  end if;
  if jsonb_typeof(new.payload#>'{changes,stage}')='object' then
    changed_field:='stage';
    from_key:=new.payload#>>'{changes,stage,from}'; to_key:=new.payload#>>'{changes,stage,to}';
  elsif jsonb_typeof(new.payload#>'{changes,current_stage}')='object' then
    changed_field:='current_stage';
    from_key:=new.payload#>>'{changes,current_stage,from}'; to_key:=new.payload#>>'{changes,current_stage,to}';
  end if;
  if from_key is not null or to_key is not null then
    select s.label into from_name from public.project_stages s where s.project_id=new.project_id and s.key=from_key;
    select s.label into to_name from public.project_stages s where s.project_id=new.project_id and s.key=to_key;
    new.payload:=new.payload||jsonb_build_object('stage_labels',jsonb_build_object(changed_field,jsonb_build_object('from',coalesce(from_name,from_key),'to',coalesce(to_name,to_key))));
  end if;
  return new;
end;
$$;
revoke all on function portal_stages_private.snapshot_activity_stage_labels() from public, anon, authenticated, service_role;
create trigger snapshot_activity_stage_labels before insert on public.project_activity for each row execute function portal_stages_private.snapshot_activity_stage_labels();

create function portal_stages_private.snapshot_approval_stage_label()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare stage_name text; stage_key text;
begin
  stage_key:=new.snapshot#>>'{task,stage}';
  select s.label into stage_name from public.project_stages s where s.project_id=new.project_id and s.key=stage_key;
  if stage_key is not null then new.snapshot:=jsonb_set(new.snapshot,'{task,stage_label}',to_jsonb(coalesce(stage_name,stage_key)),true); end if;
  return new;
end;
$$;
revoke all on function portal_stages_private.snapshot_approval_stage_label() from public, anon, authenticated, service_role;
create trigger snapshot_approval_stage_label before insert on public.task_approvals for each row execute function portal_stages_private.snapshot_approval_stage_label();
