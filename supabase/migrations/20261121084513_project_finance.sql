-- Project commercial terms and offline payments. No project receives invented amounts.
create schema portal_finance_private;
revoke all on schema portal_finance_private from public, anon, authenticated, service_role;
grant usage on schema portal_finance_private to authenticated;

create table public.project_finance (
  project_id uuid primary key references public.projects(id) on delete restrict,
  total_minor bigint not null check (total_minor between 1 and 1000000000000),
  currency text not null default 'INR' check (currency = 'INR'),
  quote_label text not null default '' check (char_length(quote_label) <= 200),
  scope_notes text not null default '' check (char_length(scope_notes) <= 10000),
  payment_instructions text not null default '' check (char_length(payment_instructions) <= 5000),
  partner_summary_visible boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp()
);
create index project_finance_created_by_idx on public.project_finance(created_by);
create index project_finance_updated_by_idx on public.project_finance(updated_by);
create table public.project_payment_milestones (
  id uuid primary key,
  project_id uuid not null references public.project_finance(project_id) on delete restrict,
  label text not null check (char_length(label) between 1 and 200 and regexp_replace(label, '[[:space:]]', '', 'g') <> ''),
  amount_minor bigint not null check (amount_minor between 1 and 1000000000000),
  due_date date check (isfinite(due_date)),
  due_condition text not null default '' check (char_length(due_condition) <= 1000),
  position integer not null default 0 check (position between 0 and 10000),
  is_due boolean not null default false,
  has_history boolean not null default false,
  unique(id, project_id)
);
create index project_payment_milestones_project_idx on public.project_payment_milestones(project_id, position, id);
create table public.project_payments (
  id uuid primary key,
  project_id uuid not null references public.project_finance(project_id) on delete restrict,
  kind text not null check (kind in ('receipt', 'refund')),
  purpose text not null default 'payment' check (purpose in ('advance', 'payment', 'other')),
  amount_minor bigint not null check (amount_minor between 1 and 1000000000000),
  paid_on date not null check (isfinite(paid_on)),
  method text not null check (char_length(method) between 1 and 80 and regexp_replace(method, '[[:space:]]', '', 'g') <> ''),
  reference text not null default '' check (char_length(reference) <= 200),
  notes text not null default '' check (char_length(notes) <= 10000),
  proof_path text check (char_length(proof_path) <= 1000 and split_part(proof_path, '/', 1) = project_id::text),
  status text not null check (status in ('reported', 'confirmed', 'rejected', 'voided')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  verified_by uuid references public.profiles(id) on delete restrict,
  verified_at timestamptz,
  review_reason text not null default '' check (char_length(review_reason) <= 1000),
  related_payment_id uuid,
  request_payload jsonb not null,
  unique(id, project_id),
  foreign key(related_payment_id, project_id) references public.project_payments(id, project_id) on delete restrict,
  check ((kind = 'receipt' and related_payment_id is null) or (kind = 'refund' and related_payment_id is not null and related_payment_id <> id)),
  check ((status = 'reported' and verified_by is null and verified_at is null and kind = 'receipt') or (status <> 'reported' and verified_by is not null and verified_at is not null))
);
create index project_payments_project_date_idx on public.project_payments(project_id, paid_on desc, created_at desc, id);
create index project_payments_related_idx on public.project_payments(related_payment_id) where related_payment_id is not null;
create index project_payments_proof_idx on public.project_payments(proof_path) where proof_path is not null;
create index project_payments_created_by_idx on public.project_payments(created_by);
create index project_payments_verified_by_idx on public.project_payments(verified_by) where verified_by is not null;
create table public.project_payment_allocations (
  payment_id uuid not null,
  milestone_id uuid not null,
  project_id uuid not null,
  amount_minor bigint not null check (amount_minor between 1 and 1000000000000),
  primary key(payment_id, milestone_id),
  foreign key(payment_id, project_id) references public.project_payments(id, project_id) on delete restrict,
  foreign key(milestone_id, project_id) references public.project_payment_milestones(id, project_id) on delete restrict
);
create index project_payment_allocations_milestone_idx on public.project_payment_allocations(milestone_id);
create index project_payment_allocations_project_idx on public.project_payment_allocations(project_id);
create table public.project_finance_audit (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  details jsonb not null
);
create index project_finance_audit_project_idx on public.project_finance_audit(project_id, created_at desc, id);
create index project_finance_audit_actor_idx on public.project_finance_audit(actor_id) where actor_id is not null;

alter table public.project_finance enable row level security;
alter table public.project_payment_milestones enable row level security;
alter table public.project_payments enable row level security;
alter table public.project_payment_allocations enable row level security;
alter table public.project_finance_audit enable row level security;
revoke all on public.project_finance, public.project_payment_milestones, public.project_payments, public.project_payment_allocations, public.project_finance_audit from public, anon, authenticated, service_role;
grant select on public.project_finance, public.project_payment_milestones, public.project_payment_allocations, public.project_finance_audit to authenticated, service_role;
grant select(id,project_id,kind,purpose,amount_minor,paid_on,method,reference,notes,proof_path,status,created_by,created_at,verified_by,verified_at,review_reason,related_payment_id)
  on public.project_payments to authenticated, service_role;

create function portal_finance_private.full_access(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (public.has_role(auth.uid(), 'admin') or exists (
    select 1 from public.project_members where project_id = p_project_id and user_id = auth.uid() and access = 'client'
  ));
$$;
revoke all on function portal_finance_private.full_access(uuid) from public, anon, authenticated, service_role;
grant execute on function portal_finance_private.full_access(uuid) to authenticated;
create policy "full project finance readers" on public.project_finance for select to authenticated using (portal_finance_private.full_access(project_id));
create policy "full project milestone readers" on public.project_payment_milestones for select to authenticated using (portal_finance_private.full_access(project_id));
create policy "full project payment readers" on public.project_payments for select to authenticated using (portal_finance_private.full_access(project_id));
create policy "full project allocation readers" on public.project_payment_allocations for select to authenticated using (portal_finance_private.full_access(project_id));
create policy "admin finance audit readers" on public.project_finance_audit for select to authenticated using (public.has_role(auth.uid(), 'admin'));

create function portal_finance_private.audit_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  previous_row jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) - 'request_payload' else null end;
  current_row jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) - 'request_payload' else null end;
  source_row jsonb := coalesce(current_row, previous_row);
begin
  insert into public.project_finance_audit(project_id, actor_id, action, entity_type, entity_id, details)
  values ((source_row->>'project_id')::uuid, auth.uid(), lower(tg_op), tg_table_name,
    coalesce(source_row->>'id', source_row->>'payment_id', source_row->>'project_id')::uuid,
    jsonb_build_object('before', previous_row, 'after', current_row));
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function portal_finance_private.audit_change() from public, anon, authenticated, service_role;
create trigger audit_project_finance after insert or update or delete on public.project_finance for each row execute function portal_finance_private.audit_change();
create trigger audit_project_milestones after insert or update or delete on public.project_payment_milestones for each row execute function portal_finance_private.audit_change();
create trigger audit_project_payments after insert or update or delete on public.project_payments for each row execute function portal_finance_private.audit_change();
create trigger audit_project_allocations after insert or update or delete on public.project_payment_allocations for each row execute function portal_finance_private.audit_change();

create function portal_finance_private.money(p_value jsonb, p_label text, p_zero boolean default true)
returns bigint language plpgsql immutable security invoker set search_path = '' as $$
declare value numeric;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'number' or char_length(p_value::text) > 24 then
    raise exception '% must be an integer amount in paise', p_label using errcode = '22023';
  end if;
  value := p_value::text::numeric;
  if value <> trunc(value) or value > 1000000000000 or value < (case when p_zero then 0 else 1 end) then
    raise exception '% is outside the supported amount range', p_label using errcode = '22023';
  end if;
  return value::bigint;
end;
$$;
create function portal_finance_private.text_value(p_object jsonb, p_key text, p_max integer, p_required boolean default false)
returns text language plpgsql immutable security invoker set search_path = '' as $$
declare value text;
begin
  if p_object ? p_key and jsonb_typeof(p_object->p_key) not in ('string', 'null') then
    raise exception '% must be text', p_key using errcode = '22023';
  end if;
  value := btrim(coalesce(p_object->>p_key, ''));
  if char_length(value) > p_max or (p_required and regexp_replace(value, '[[:space:]]', '', 'g') = '') then
    raise exception '% is missing or too long', p_key using errcode = '22023';
  end if;
  return value;
end;
$$;
create function portal_finance_private.assert_keys(p_object jsonb, p_keys text[])
returns void language plpgsql immutable security invoker set search_path = '' as $$
begin
  if jsonb_typeof(p_object) is distinct from 'object' or exists (select 1 from jsonb_object_keys(p_object) k where not (k = any(p_keys))) then
    raise exception 'Unsupported financial fields' using errcode = '22023';
  end if;
end;
$$;
create function portal_finance_private.boolean_value(p_object jsonb, p_key text)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
begin
  if not (p_object ? p_key) then return false; end if;
  if jsonb_typeof(p_object->p_key) is distinct from 'boolean' then raise exception '% must be true or false', p_key using errcode = '22023'; end if;
  return (p_object->>p_key)::boolean;
end;
$$;
revoke all on function portal_finance_private.money(jsonb,text,boolean), portal_finance_private.text_value(jsonb,text,integer,boolean), portal_finance_private.assert_keys(jsonb,text[]), portal_finance_private.boolean_value(jsonb,text) from public, anon, authenticated, service_role;

-- Per-project serialization protects payments, allocation changes, refunds and plan edits.
create function portal_finance_private.lock_project(p_project_id uuid, p_admin boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or (p_admin and not public.has_role(auth.uid(), 'admin'))
    or (not p_admin and not portal_finance_private.full_access(p_project_id)) then
    raise exception 'Project finance access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then raise exception 'Project not found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('project-finance:' || p_project_id::text, 0));
end;
$$;
revoke all on function portal_finance_private.lock_project(uuid,boolean) from public, anon, authenticated, service_role;

create function portal_finance_private.assert_balances(p_project_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare agreed bigint;
begin
  select total_minor into agreed from public.project_finance where project_id = p_project_id;
  if agreed is null then raise exception 'Configure the project payment plan first' using errcode = '55000'; end if;
  if (select coalesce(sum(amount_minor),0) from public.project_payment_milestones where project_id = p_project_id) > agreed then
    raise exception 'Milestones cannot exceed the agreed project amount' using errcode = '23514';
  end if;
  if (select coalesce(sum(amount_minor),0) from public.project_payments where project_id = p_project_id and kind = 'receipt' and status in ('confirmed','reported')) > 1000000000000 then
    raise exception 'Project receipts exceed the supported amount range' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.project_payments p left join public.project_payment_allocations a on a.payment_id = p.id
    where p.project_id = p_project_id group by p.id having coalesce(sum(a.amount_minor),0) > p.amount_minor
  ) then raise exception 'Allocations exceed the payment amount' using errcode = '23514'; end if;
  if exists (
    select 1 from public.project_payment_milestones m left join public.project_payment_allocations a on a.milestone_id = m.id
    left join public.project_payments p on p.id = a.payment_id
    where m.project_id = p_project_id group by m.id having
      coalesce(sum(case when p.status = 'confirmed' then case when p.kind = 'receipt' then a.amount_minor else -a.amount_minor end else 0 end),0) not between 0 and m.amount_minor
  ) then raise exception 'Confirmed milestone payments exceed its amount' using errcode = '23514'; end if;
  if exists (
    select 1 from public.project_payments receipt where receipt.project_id = p_project_id and receipt.kind = 'receipt' and (
      (select coalesce(sum(r.amount_minor),0) from public.project_payments r where r.related_payment_id = receipt.id and r.status = 'confirmed') > receipt.amount_minor
      or (receipt.status <> 'confirmed' and exists (select 1 from public.project_payments r where r.related_payment_id = receipt.id and r.status = 'confirmed'))
    )
  ) then raise exception 'Refunds require a confirmed receipt and cannot exceed its remaining amount' using errcode = '23514'; end if;
  if exists (
    select 1 from public.project_payments refund join public.project_payment_allocations a on a.payment_id = refund.id
    where refund.project_id = p_project_id and refund.kind = 'refund' and refund.status = 'confirmed'
    group by refund.related_payment_id, a.milestone_id having sum(a.amount_minor) > coalesce((
      select amount_minor from public.project_payment_allocations original where original.payment_id = refund.related_payment_id and original.milestone_id = a.milestone_id
    ),0)
  ) then raise exception 'Refund allocations exceed the original milestone payments' using errcode = '23514'; end if;
  if exists (
    select 1 from public.project_payments receipt where receipt.project_id = p_project_id and receipt.kind = 'receipt' and (
      select coalesce(sum(r.amount_minor - coalesce((select sum(a.amount_minor) from public.project_payment_allocations a where a.payment_id = r.id),0)),0)
      from public.project_payments r where r.related_payment_id = receipt.id and r.status = 'confirmed'
    ) > receipt.amount_minor - coalesce((select sum(a.amount_minor) from public.project_payment_allocations a where a.payment_id = receipt.id),0)
  ) then raise exception 'Refund exceeds the original unallocated credit; choose the refunded milestones' using errcode = '23514'; end if;
end;
$$;
revoke all on function portal_finance_private.assert_balances(uuid) from public, anon, authenticated, service_role;

create function portal_finance_private.allocations_json(p_payment_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('milestone_id', milestone_id, 'amount_minor', amount_minor) order by milestone_id), '[]'::jsonb)
  from public.project_payment_allocations where payment_id = p_payment_id;
$$;
create function portal_finance_private.normalize_allocations(p_project_id uuid, p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare item jsonb; result jsonb := '[]'::jsonb; milestone uuid; amount bigint;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 100 then raise exception 'Choose up to 100 milestone allocations' using errcode = '22023'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    perform portal_finance_private.assert_keys(item, array['milestone_id','amount_minor']);
    milestone := (item->>'milestone_id')::uuid;
    amount := portal_finance_private.money(item->'amount_minor','Allocation',false);
    if milestone is null or not exists (select 1 from public.project_payment_milestones where id = milestone and project_id = p_project_id) then raise exception 'Allocation milestone does not belong to this project' using errcode = '23514'; end if;
    if exists (select 1 from jsonb_array_elements(result) r where r->>'milestone_id' = milestone::text) then raise exception 'Choose each milestone only once' using errcode = '22023'; end if;
    result := result || jsonb_build_array(jsonb_build_object('milestone_id',milestone,'amount_minor',amount));
  end loop;
  return (select coalesce(jsonb_agg(value order by value->>'milestone_id'),'[]'::jsonb) from jsonb_array_elements(result));
end;
$$;
create function portal_finance_private.replace_allocations(p_project_id uuid, p_payment_id uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.project_payment_allocations where payment_id = p_payment_id;
  insert into public.project_payment_allocations(payment_id, milestone_id, project_id, amount_minor)
    select p_payment_id, (value->>'milestone_id')::uuid, p_project_id, (value->>'amount_minor')::bigint from jsonb_array_elements(p_rows);
  update public.project_payment_milestones set has_history = true
    where project_id = p_project_id and not has_history and id in (select (value->>'milestone_id')::uuid from jsonb_array_elements(p_rows));
end;
$$;
revoke all on function portal_finance_private.allocations_json(uuid), portal_finance_private.normalize_allocations(uuid,jsonb), portal_finance_private.replace_allocations(uuid,uuid,jsonb) from public, anon, authenticated, service_role;

create function public.get_project_finance(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); access_kind text; plan_row public.project_finance;
  plan_json jsonb; milestones_json jsonb := '[]'::jsonb; payments_json jsonb := '[]'::jsonb;
  allocations_json jsonb := '[]'::jsonb; audit_json jsonb := '[]'::jsonb;
  received bigint; refunded bigint; pending bigint; allocated bigint; due_gross bigint; net bigint; credit bigint;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if public.has_role(actor,'admin') then access_kind := 'admin';
  elsif exists (select 1 from public.project_members where project_id = p_project_id and user_id = actor and access = 'client') then access_kind := 'client';
  elsif exists (select 1 from public.project_members where project_id = p_project_id and user_id = actor) then access_kind := 'restricted';
  else raise exception 'Project finance access required' using errcode = '42501'; end if;
  if not exists (select 1 from public.projects where id = p_project_id) then raise exception 'Project not found' using errcode = 'P0002'; end if;
  select * into plan_row from public.project_finance where project_id = p_project_id;
  if access_kind = 'restricted' and plan_row.partner_summary_visible and exists (
    select 1 from public.project_members where project_id = p_project_id and user_id = actor and access = 'partner'
  ) then access_kind := 'partner'; end if;
  if access_kind = 'restricted' or plan_row.project_id is null then
    return jsonb_build_object('access',access_kind,'configured',false,'plan',null,'milestones','[]'::jsonb,'payments','[]'::jsonb,'allocations','[]'::jsonb,'summary',null,'audit','[]'::jsonb);
  end if;
  plan_json := case when access_kind = 'partner' then jsonb_build_object(
    'project_id',plan_row.project_id,'total_minor',plan_row.total_minor,'currency',plan_row.currency,
    'quote_label',plan_row.quote_label,'version',plan_row.version,'partner_summary_visible',plan_row.partner_summary_visible
  ) else to_jsonb(plan_row) end;
  select coalesce(jsonb_agg(to_jsonb(calculated) order by position,id),'[]'::jsonb) into milestones_json from (
    select m.*, coalesce((select sum(case when p.kind='receipt' then a.amount_minor else -a.amount_minor end)
      from public.project_payment_allocations a join public.project_payments p on p.id=a.payment_id
      where a.milestone_id=m.id and p.status='confirmed'),0)::bigint as paid_minor
    from public.project_payment_milestones m where m.project_id=p_project_id
  ) calculated;
  select coalesce(sum(amount_minor) filter(where kind='receipt' and status='confirmed'),0)::bigint,
    coalesce(sum(amount_minor) filter(where kind='refund' and status='confirmed'),0)::bigint,
    coalesce(sum(amount_minor) filter(where kind='receipt' and status='reported'),0)::bigint
    into received,refunded,pending from public.project_payments where project_id=p_project_id;
  select coalesce(sum(case when p.kind='receipt' then a.amount_minor else -a.amount_minor end),0)::bigint into allocated
    from public.project_payment_allocations a join public.project_payments p on p.id=a.payment_id
    where a.project_id=p_project_id and p.status='confirmed';
  select coalesce(sum(greatest((m->>'amount_minor')::bigint-(m->>'paid_minor')::bigint,0)),0)::bigint into due_gross
    from jsonb_array_elements(milestones_json) m
    where (m->>'is_due')::boolean or nullif(m->>'due_date','')::date <= (clock_timestamp() at time zone 'Asia/Kolkata')::date;
  net := received-refunded; credit := net-allocated;
  if access_kind in ('admin','client') then
    select coalesce(jsonb_agg(to_jsonb(p)-'request_payload' order by p.paid_on desc,p.created_at desc,p.id),'[]'::jsonb)
      into payments_json from public.project_payments p where p.project_id=p_project_id;
    select coalesce(jsonb_agg(to_jsonb(a) order by a.payment_id,a.milestone_id),'[]'::jsonb)
      into allocations_json from public.project_payment_allocations a where a.project_id=p_project_id;
  end if;
  if access_kind='admin' then
    select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id desc),'[]'::jsonb) into audit_json
      from (select * from public.project_finance_audit where project_id=p_project_id order by created_at desc,id desc limit 100) a;
  end if;
  return jsonb_build_object('access',access_kind,'configured',true,'plan',plan_json,'milestones',milestones_json,
    'payments',payments_json,'allocations',allocations_json,'audit',audit_json,
    'summary',jsonb_build_object('received_minor',received,'refunded_minor',refunded,'net_received_minor',net,'pending_minor',pending,
      'unallocated_minor',credit,'outstanding_minor',greatest(plan_row.total_minor-net,0),'credit_minor',greatest(net-plan_row.total_minor,0),
      'due_now_minor',greatest(due_gross-credit,0)));
end;
$$;
revoke all on function public.get_project_finance(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_project_finance(uuid) to authenticated;

create function public.save_project_finance(p_project_id uuid, p_expected_version integer, p_plan jsonb, p_milestones jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); old_plan public.project_finance; item jsonb; milestone uuid; existing public.project_payment_milestones;
  agreed bigint; milestone_amount bigint; ids uuid[] := '{}'; position_value bigint; due_value date;
begin
  perform portal_finance_private.lock_project(p_project_id,true);
  perform portal_finance_private.assert_keys(p_plan,array['total_minor','currency','quote_label','scope_notes','payment_instructions','partner_summary_visible']);
  if jsonb_typeof(p_milestones) is distinct from 'array' or jsonb_array_length(p_milestones)>100 then raise exception 'Choose up to 100 payment milestones' using errcode='22023'; end if;
  agreed := portal_finance_private.money(p_plan->'total_minor','Agreed amount',false);
  if p_plan->>'currency' is distinct from 'INR' then raise exception 'Choose INR for this payment plan' using errcode='22023'; end if;
  select * into old_plan from public.project_finance where project_id=p_project_id for update;
  if p_expected_version is null or p_expected_version <> coalesce(old_plan.version,0) then raise exception 'The payment plan changed. Reload it before saving.' using errcode='40001'; end if;
  insert into public.project_finance(project_id,total_minor,currency,quote_label,scope_notes,payment_instructions,partner_summary_visible,version,created_by,updated_by)
    values(p_project_id,agreed,'INR',portal_finance_private.text_value(p_plan,'quote_label',200),portal_finance_private.text_value(p_plan,'scope_notes',10000),
      portal_finance_private.text_value(p_plan,'payment_instructions',5000),portal_finance_private.boolean_value(p_plan,'partner_summary_visible'),1,actor,actor)
    on conflict(project_id) do update set total_minor=excluded.total_minor,quote_label=excluded.quote_label,scope_notes=excluded.scope_notes,
      payment_instructions=excluded.payment_instructions,partner_summary_visible=excluded.partner_summary_visible,
      version=public.project_finance.version+1,updated_by=actor,updated_at=clock_timestamp();
  for item in select value from jsonb_array_elements(p_milestones) loop
    perform portal_finance_private.assert_keys(item,array['id','label','amount_minor','due_date','due_condition','position','is_due']);
    milestone := (item->>'id')::uuid;
    if milestone is null or milestone=any(ids) then raise exception 'Each milestone needs a unique ID' using errcode='22023'; end if;
    ids := array_append(ids,milestone);
    select * into existing from public.project_payment_milestones where id=milestone;
    if existing.id is not null and existing.project_id<>p_project_id then raise exception 'Milestone belongs to another project' using errcode='23514'; end if;
    milestone_amount := portal_finance_private.money(item->'amount_minor','Milestone amount',false);
    position_value := portal_finance_private.money(coalesce(item->'position',to_jsonb(array_length(ids,1)-1)),'Milestone position');
    if position_value>10000 then raise exception 'Milestone position is out of range' using errcode='22023'; end if;
    due_value := nullif(portal_finance_private.text_value(item,'due_date',10),'')::date;
    if due_value is not null and not isfinite(due_value) then raise exception 'Choose a valid milestone due date' using errcode='22023'; end if;
    insert into public.project_payment_milestones(id,project_id,label,amount_minor,due_date,due_condition,position,is_due)
      values(milestone,p_project_id,portal_finance_private.text_value(item,'label',200,true),milestone_amount,due_value,
        portal_finance_private.text_value(item,'due_condition',1000),position_value::integer,portal_finance_private.boolean_value(item,'is_due'))
      on conflict(id) do update set label=excluded.label,amount_minor=excluded.amount_minor,due_date=excluded.due_date,
        due_condition=excluded.due_condition,position=excluded.position,is_due=excluded.is_due;
  end loop;
  if exists(select 1 from public.project_payment_milestones where project_id=p_project_id and not(id=any(ids)) and has_history) then
    raise exception 'A milestone with payment history cannot be removed' using errcode='23514';
  end if;
  delete from public.project_payment_milestones where project_id=p_project_id and not(id=any(ids));
  perform portal_finance_private.assert_balances(p_project_id);
  return public.get_project_finance(p_project_id);
end;
$$;
revoke all on function public.save_project_finance(uuid,integer,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_project_finance(uuid,integer,jsonb,jsonb) to authenticated;

create function portal_finance_private.path_project(p_path text)
returns uuid language sql immutable security invoker set search_path='' as $$
  select case when split_part(p_path,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(p_path,'/',1)::uuid end;
$$;
create function portal_finance_private.check_proof(p_project_id uuid,p_path text,p_admin boolean)
returns void language plpgsql stable security definer set search_path='' as $$
declare object_row storage.objects; bytes bigint;
begin
  if p_path is null then return; end if;
  if char_length(p_path)>1000 or p_path !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_.-]+\.(pdf|png|jpe?g|webp)$'
    or portal_finance_private.path_project(p_path) is distinct from p_project_id
    or (not p_admin and split_part(p_path,'/',2)<>auth.uid()::text) then raise exception 'Choose an uploaded proof from this project' using errcode='23514'; end if;
  select * into object_row from storage.objects where bucket_id='project-finance' and name=p_path;
  bytes := case when object_row.metadata->>'size' ~ '^[0-9]{1,8}$' then (object_row.metadata->>'size')::bigint else 0 end;
  if object_row.id is null or bytes not between 1 and 5242880 or coalesce(object_row.metadata->>'mimetype','') not in ('application/pdf','image/png','image/jpeg','image/webp')
    or not (case object_row.metadata->>'mimetype' when 'application/pdf' then p_path ~* '\.pdf$' when 'image/png' then p_path ~* '\.png$'
      when 'image/jpeg' then p_path ~* '\.jpe?g$' when 'image/webp' then p_path ~* '\.webp$' else false end) then
    raise exception 'Finish uploading a PDF, PNG, JPEG or WebP proof up to 5 MiB' using errcode='23514';
  end if;
end;
$$;
revoke all on function portal_finance_private.path_project(text), portal_finance_private.check_proof(uuid,text,boolean) from public,anon,authenticated,service_role;

create function public.record_project_payment(p_project_id uuid,p_payment jsonb,p_allocations jsonb default '[]')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); is_admin boolean; payment_uuid uuid; source_uuid uuid; value bigint; paid date; kind_value text; purpose_value text;
  method_value text; reference_value text; notes_value text; path_value text; canonical jsonb; allocation_rows jsonb; existing public.project_payments; source public.project_payments;
begin
  perform portal_finance_private.lock_project(p_project_id,false);
  if not exists(select 1 from public.project_finance where project_id=p_project_id) then raise exception 'Configure the project payment plan first' using errcode='55000'; end if;
  is_admin:=public.has_role(actor,'admin');
  perform portal_finance_private.assert_keys(p_payment,array['id','kind','purpose','amount_minor','paid_on','method','reference','notes','proof_path','related_payment_id']);
  payment_uuid:=(p_payment->>'id')::uuid;
  if payment_uuid is null then raise exception 'A payment ID is required for safe retries' using errcode='22023'; end if;
  kind_value:=portal_finance_private.text_value(p_payment,'kind',20,true);
  purpose_value:=portal_finance_private.text_value(p_payment,'purpose',20,true);
  if kind_value not in ('receipt','refund') or purpose_value not in ('advance','payment','other') then raise exception 'Choose a payment kind and purpose' using errcode='22023'; end if;
  if not is_admin and kind_value<>'receipt' then raise exception 'Only an admin can record refunds' using errcode='42501'; end if;
  value:=portal_finance_private.money(p_payment->'amount_minor','Payment amount',false);
  paid:=portal_finance_private.text_value(p_payment,'paid_on',10,true)::date;
  if not isfinite(paid) or paid>(clock_timestamp() at time zone 'Asia/Kolkata')::date then raise exception 'Choose the actual payment date, up to today' using errcode='22023'; end if;
  method_value:=portal_finance_private.text_value(p_payment,'method',80,true);
  reference_value:=portal_finance_private.text_value(p_payment,'reference',200);
  notes_value:=portal_finance_private.text_value(p_payment,'notes',10000);
  path_value:=nullif(portal_finance_private.text_value(p_payment,'proof_path',1000),'');
  source_uuid:=nullif(portal_finance_private.text_value(p_payment,'related_payment_id',36),'')::uuid;
  allocation_rows:=portal_finance_private.normalize_allocations(p_project_id,coalesce(p_allocations,'[]'::jsonb));
  if not is_admin and jsonb_array_length(allocation_rows)>0 then
    raise exception 'Only an admin can allocate project payments' using errcode='42501';
  end if;
  canonical:=jsonb_build_object('id',payment_uuid,'project_id',p_project_id,'kind',kind_value,'purpose',purpose_value,'amount_minor',value,'paid_on',paid,
    'method',method_value,'reference',reference_value,'notes',notes_value,'proof_path',path_value,'related_payment_id',source_uuid,'created_by',actor,'allocations',allocation_rows);
  select * into existing from public.project_payments where id=payment_uuid;
  if existing.id is not null then
    if existing.project_id=p_project_id and existing.request_payload=canonical then return public.get_project_finance(p_project_id); end if;
    raise exception 'This payment ID was already used for different details' using errcode='23505';
  end if;
  if kind_value='receipt' and source_uuid is not null then raise exception 'Receipts cannot refer to another payment' using errcode='22023'; end if;
  if kind_value='refund' then
    select * into source from public.project_payments where id=source_uuid and project_id=p_project_id;
    if source.id is null or source.kind<>'receipt' or source.status<>'confirmed' or paid<source.paid_on then
      raise exception 'Choose a confirmed receipt and a valid refund date' using errcode='23514'; end if;
  end if;
  perform portal_finance_private.check_proof(p_project_id,path_value,is_admin);
  insert into public.project_payments(id,project_id,kind,purpose,amount_minor,paid_on,method,reference,notes,proof_path,status,created_by,verified_by,verified_at,related_payment_id,request_payload)
    values(payment_uuid,p_project_id,kind_value,purpose_value,value,paid,method_value,reference_value,notes_value,path_value,
      case when is_admin then 'confirmed' else 'reported' end,actor,case when is_admin then actor end,case when is_admin then clock_timestamp() end,source_uuid,canonical);
  perform portal_finance_private.replace_allocations(p_project_id,payment_uuid,allocation_rows);
  perform portal_finance_private.assert_balances(p_project_id);
  return public.get_project_finance(p_project_id);
end;
$$;
revoke all on function public.record_project_payment(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_project_payment(uuid,jsonb,jsonb) to authenticated;

create function public.review_project_payment(p_payment_id uuid,p_decision text,p_reason text default '',p_allocations jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); payment public.project_payments; target_status text; reason_value text; allocation_rows jsonb;
begin
  if actor is null or not public.has_role(actor,'admin') then raise exception 'Administrator access required' using errcode='42501'; end if;
  select * into payment from public.project_payments where id=p_payment_id;
  if payment.id is null then raise exception 'Payment not found' using errcode='P0002'; end if;
  perform portal_finance_private.lock_project(payment.project_id,true);
  select * into payment from public.project_payments where id=p_payment_id for update;
  target_status:=case p_decision when 'confirm' then 'confirmed' when 'reject' then 'rejected' when 'void' then 'voided' end;
  reason_value:=btrim(coalesce(p_reason,''));
  if target_status is null or char_length(reason_value)>1000 then raise exception 'Choose a supported payment decision' using errcode='22023'; end if;
  if target_status in ('rejected','voided') and regexp_replace(reason_value,'[[:space:]]','','g')='' then raise exception 'A reason is required for this decision' using errcode='22023'; end if;
  allocation_rows:=case when p_allocations is null then portal_finance_private.allocations_json(p_payment_id) else portal_finance_private.normalize_allocations(payment.project_id,p_allocations) end;
  if payment.status=target_status then
    if payment.review_reason=reason_value and allocation_rows=portal_finance_private.allocations_json(p_payment_id) then return public.get_project_finance(payment.project_id); end if;
    raise exception 'This payment was already reviewed with different details' using errcode='55000';
  end if;
  if p_decision in ('confirm','reject') and (payment.status<>'reported' or payment.kind<>'receipt') then raise exception 'Only a reported receipt can be confirmed or rejected' using errcode='55000'; end if;
  if p_decision='void' and payment.status not in ('reported','confirmed') then raise exception 'Only an active payment can be voided' using errcode='55000'; end if;
  if p_decision='void' and payment.kind='receipt' and exists(select 1 from public.project_payments where related_payment_id=p_payment_id and status='confirmed') then
    raise exception 'Void the linked refunds before voiding their receipt' using errcode='23514'; end if;
  if p_decision<>'confirm' and p_allocations is not null and allocation_rows<>portal_finance_private.allocations_json(p_payment_id) then
    raise exception 'Allocations can be changed while confirming, not while rejecting or voiding' using errcode='22023'; end if;
  if p_decision='confirm' then perform portal_finance_private.replace_allocations(payment.project_id,p_payment_id,allocation_rows); end if;
  update public.project_payments set status=target_status,verified_by=actor,verified_at=clock_timestamp(),review_reason=reason_value where id=p_payment_id;
  perform portal_finance_private.assert_balances(payment.project_id);
  return public.get_project_finance(payment.project_id);
end;
$$;
revoke all on function public.review_project_payment(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.review_project_payment(uuid,text,text,jsonb) to authenticated;

create function public.allocate_project_payment(p_payment_id uuid,p_allocations jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payment public.project_payments; rows_json jsonb;
begin
  if auth.uid() is null or not public.has_role(auth.uid(),'admin') then raise exception 'Administrator access required' using errcode='42501'; end if;
  select * into payment from public.project_payments where id=p_payment_id;
  if payment.id is null then raise exception 'Payment not found' using errcode='P0002'; end if;
  perform portal_finance_private.lock_project(payment.project_id,true);
  select * into payment from public.project_payments where id=p_payment_id for update;
  if payment.kind<>'receipt' or payment.status<>'confirmed' then raise exception 'Only a confirmed receipt can be allocated' using errcode='55000'; end if;
  rows_json:=portal_finance_private.normalize_allocations(payment.project_id,p_allocations);
  if rows_json=portal_finance_private.allocations_json(p_payment_id) then return public.get_project_finance(payment.project_id); end if;
  if exists(select 1 from public.project_payments where related_payment_id=p_payment_id and status='confirmed') then
    raise exception 'Void linked refunds before changing this receipt allocation' using errcode='23514'; end if;
  perform portal_finance_private.replace_allocations(payment.project_id,p_payment_id,rows_json);
  perform portal_finance_private.assert_balances(payment.project_id);
  return public.get_project_finance(payment.project_id);
end;
$$;
revoke all on function public.allocate_project_payment(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.allocate_project_payment(uuid,jsonb) to authenticated;

-- Proofs have a separate private bucket: ordinary project editors never inherit
-- access to bank references or proof files through the project-files policies.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('project-finance','project-finance',false,5242880,array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict(id) do nothing;
do $$ begin
  if exists(select 1 from storage.buckets where id='project-finance' and
    (public or file_size_limit is distinct from 5242880::bigint or allowed_mime_types is distinct from array['application/pdf','image/png','image/jpeg','image/webp']::text[])) then
    raise exception 'The project-finance bucket must be private with the expected 5 MiB document/image limits';
  end if;
end $$;

create function portal_finance_private.proof_access(p_path text,p_own boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and char_length(p_path)<=1000
    and p_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_.-]+\.(pdf|png|jpe?g|webp)$'
    and portal_finance_private.full_access(portal_finance_private.path_project(p_path))
    and exists(select 1 from public.project_finance where project_id=portal_finance_private.path_project(p_path))
    and (not p_own or split_part(p_path,'/',2)=auth.uid()::text);
$$;
create function portal_finance_private.proof_cleanup(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
  select portal_finance_private.proof_access(p_path,false)
    and (public.has_role(auth.uid(),'admin') or split_part(p_path,'/',2)=auth.uid()::text)
    and not exists(select 1 from public.project_payments where proof_path=p_path);
$$;
revoke all on function portal_finance_private.proof_access(text,boolean),portal_finance_private.proof_cleanup(text) from public,anon,authenticated,service_role;
grant execute on function portal_finance_private.proof_access(text,boolean),portal_finance_private.proof_cleanup(text) to authenticated;
create policy "finance proof full readers" on storage.objects for select to authenticated
  using(bucket_id='project-finance' and portal_finance_private.proof_access(name,false));
create policy "finance proof own uploads" on storage.objects for insert to authenticated
  with check(bucket_id='project-finance' and portal_finance_private.proof_access(name,true));
create policy "finance proof unused cleanup" on storage.objects for delete to authenticated
  using(bucket_id='project-finance' and portal_finance_private.proof_cleanup(name));

create function portal_finance_private.retain_proof()
returns trigger language plpgsql security definer set search_path='' as $$
declare project_uuid uuid;
begin
  if old.bucket_id<>'project-finance' then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  project_uuid:=portal_finance_private.path_project(old.name);
  if project_uuid is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('project-finance:'||project_uuid::text,0));
  end if;
  -- The same lock is held by payment writes. A proof cannot disappear between
  -- validation and attachment, even when a storage operator bypasses RLS.
  if exists(select 1 from public.project_payments where proof_path=old.name) then
    if tg_op='DELETE' then raise exception 'Payment proofs are retained with their ledger history' using errcode='23514'; end if;
    if old.bucket_id is distinct from new.bucket_id or old.name is distinct from new.name or old.metadata is distinct from new.metadata then
      raise exception 'Payment proofs are retained with their ledger history' using errcode='23514';
    end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function portal_finance_private.retain_proof() from public,anon,authenticated,service_role;
create trigger retain_project_finance_proof before update or delete on storage.objects
  for each row execute function portal_finance_private.retain_proof();
