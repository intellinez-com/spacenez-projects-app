
create type public.app_role as enum ('admin','partner','client');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  company text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "own roles or admin" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "admin manage roles" on public.user_roles for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_name text,
  location text,
  project_type text not null default 'Apartment',
  description text,
  current_stage text not null default 'planning',
  status text not null default 'active',
  start_date date,
  target_date date,
  created_by uuid,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.projects to authenticated;
grant all on public.projects to service_role;
alter table public.projects enable row level security;

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  access text not null default 'client',
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);
grant select, insert, update, delete on public.project_members to authenticated;
grant all on public.project_members to service_role;
alter table public.project_members enable row level security;

create or replace function public.is_project_member(_project uuid, _user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members where project_id = _project and user_id = _user)
$$;
create or replace function public.can_edit_project(_project uuid, _user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_user,'admin') or exists (
    select 1 from public.project_members where project_id = _project and user_id = _user and access = 'partner')
$$;
create or replace function public.can_view_project(_project uuid, _user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_user,'admin') or public.is_project_member(_project,_user)
$$;

create policy "view projects" on public.projects for select to authenticated using (public.can_view_project(id, auth.uid()));
create policy "admin insert projects" on public.projects for insert to authenticated with check (public.has_role(auth.uid(),'admin'));
create policy "editors update projects" on public.projects for update to authenticated using (public.can_edit_project(id, auth.uid()));
create policy "admin delete projects" on public.projects for delete to authenticated using (public.has_role(auth.uid(),'admin'));

create policy "view members" on public.project_members for select to authenticated using (public.can_view_project(project_id, auth.uid()));
create policy "admin manage members" on public.project_members for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- profiles policies (after members exist)
create policy "view profiles" on public.profiles for select to authenticated using (
  id = auth.uid() or public.has_role(auth.uid(),'admin') or exists (
    select 1 from public.project_members a join public.project_members b on a.project_id = b.project_id
    where a.user_id = auth.uid() and b.user_id = profiles.id));
create policy "update own profile" on public.profiles for update to authenticated using (id = auth.uid() or public.has_role(auth.uid(),'admin'));

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  stage text not null default 'planning',
  status text not null default 'not_started',
  priority text not null default 'medium',
  assignee_id uuid references public.profiles(id) on delete set null,
  start_date date,
  due_date date,
  position double precision not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.tasks to authenticated;
grant all on public.tasks to service_role;
alter table public.tasks enable row level security;
create policy "view tasks" on public.tasks for select to authenticated using (public.can_view_project(project_id, auth.uid()));
create policy "edit tasks ins" on public.tasks for insert to authenticated with check (public.can_edit_project(project_id, auth.uid()));
create policy "edit tasks upd" on public.tasks for update to authenticated using (public.can_edit_project(project_id, auth.uid()));
create policy "edit tasks del" on public.tasks for delete to authenticated using (public.can_edit_project(project_id, auth.uid()));

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
grant select, insert, delete on public.comments to authenticated;
grant all on public.comments to service_role;
alter table public.comments enable row level security;
create policy "view comments" on public.comments for select to authenticated using (public.can_view_project(project_id, auth.uid()));
create policy "add comments" on public.comments for insert to authenticated with check (user_id = auth.uid() and public.can_view_project(project_id, auth.uid()));
create policy "delete own comments" on public.comments for delete to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  name text not null,
  path text not null,
  size bigint,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert, delete on public.documents to authenticated;
grant all on public.documents to service_role;
alter table public.documents enable row level security;
create policy "view docs" on public.documents for select to authenticated using (public.can_view_project(project_id, auth.uid()));
create policy "add docs" on public.documents for insert to authenticated with check (public.can_edit_project(project_id, auth.uid()));
create policy "delete docs" on public.documents for delete to authenticated using (public.can_edit_project(project_id, auth.uid()));

-- new user: profile + role (first user becomes admin, others default client)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, company)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.raw_user_meta_data->>'company');
  if not exists (select 1 from public.user_roles where role = 'admin') then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  end if;
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
