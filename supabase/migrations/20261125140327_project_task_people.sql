-- Global admins can edit projects without a project_members row. Keep the
-- assignment directory project-scoped rather than broadening profiles/roles RLS.
create schema if not exists portal_people_private;
revoke all on schema portal_people_private from public, anon, authenticated;
grant usage on schema portal_people_private to authenticated;

create function portal_people_private.get_project_task_people(p_project_id uuid)
returns table (id uuid, full_name text, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  editor boolean;
begin
  if actor is null then
    raise exception 'Sign in to view project people.' using errcode = '42501';
  end if;
  -- can_view_project intentionally grants global admins access; an actual
  -- project must also exist before any directory entries can be returned.
  if not exists (select 1 from public.projects p where p.id = p_project_id)
     or not public.can_view_project(p_project_id, actor) then
    raise exception 'Project not found or access denied.' using errcode = '42501';
  end if;
  editor := public.can_edit_project(p_project_id, actor);

  return query
    with candidates as (
      select m.user_id as person_id
      from public.project_members m
      where m.project_id = p_project_id
      union
      select t.assignee_id as person_id
      from public.tasks t
      where t.project_id = p_project_id and t.assignee_id is not null
      union
      select r.user_id as person_id
      from public.user_roles r
      where editor and r.role = 'admin'::public.app_role
    ), people as (
      select p.id, p.email,
        coalesce(nullif(btrim(p.full_name), ''),
                 nullif(btrim(split_part(coalesce(p.email, ''), '@', 1)), ''),
                 'Team member') as display_name
      from public.profiles p
      join candidates c on c.person_id = p.id
    )
    select p.id, p.display_name, case when editor then p.email else null::text end
    from people p
    order by lower(p.display_name), p.id;
end;
$$;

revoke all on function portal_people_private.get_project_task_people(uuid) from public, anon, authenticated;
grant execute on function portal_people_private.get_project_task_people(uuid) to authenticated;

-- The exposed RPC runs as its caller. Privileged directory reads stay inside the
-- non-exposed helper, which performs its own access checks even if called directly.
create function public.get_project_task_people(p_project_id uuid)
returns table (id uuid, full_name text, email text)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.full_name, p.email
  from portal_people_private.get_project_task_people(p_project_id) p;
$$;

revoke all on function public.get_project_task_people(uuid) from public, anon, authenticated;
grant execute on function public.get_project_task_people(uuid) to authenticated;
