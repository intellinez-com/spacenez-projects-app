// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const admin = "00000000-0000-4000-8000-000000000001";
const partner = "00000000-0000-4000-8000-000000000002";
const client = "00000000-0000-4000-8000-000000000003";
const otherAdmin = "00000000-0000-4000-8000-000000000004";
const source = "10000000-0000-4000-8000-000000000001";
const sourceTask = "20000000-0000-4000-8000-000000000001";
const secondTask = "20000000-0000-4000-8000-000000000002";
const customStage = "custom_30000000-0000-4000-8000-000000000001";
type CopyResult = { project_id: string; created: boolean; task_count: number; approval_plan_count: number; stage_count: number };
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;
    grant usage on schema public,auth,storage to authenticated,anon,service_role;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null,metadata jsonb default '{}',unique(bucket_id,name));
    create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
    grant all on storage.objects to authenticated,service_role;
    alter table storage.objects enable row level security;
    insert into storage.buckets(id,name,public,file_size_limit) values('project-files','project-files',false,52428800);
  `);
  for (const file of ["0000_migration.sql", "0001_migration.sql"]) await db.exec(await readFile(resolve("drizzle/migrations", file), "utf8"));
  for (const file of (await readdir(resolve("supabase/migrations"))).filter((file) => file.endsWith(".sql")).sort()) {
    await db.exec(await readFile(resolve("supabase/migrations", file), "utf8"));
  }
  await db.exec(`
    insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
      ('${admin}','admin@example.test',now(),'{"full_name":"Admin"}'),
      ('${partner}','partner@example.test',now(),'{"full_name":"Partner"}'),
      ('${client}','client@example.test',now(),'{"full_name":"Old Client"}'),
      ('${otherAdmin}','other-admin@example.test',now(),'{"full_name":"Other Admin"}');
    insert into public.user_roles(user_id,role) values('${partner}','partner'),('${client}','client'),('${otherAdmin}','admin');
    insert into public.projects(id,name,client_name,client_brand,client_email,location,project_type,description,status,start_date,target_date,meeting_url,created_by)
      values('${source}','Old client restaurant','Old Client','Old Brand','client@example.test','Old site','Restaurant / Café','Old project private notes','completed','2026-01-01','2026-05-01','https://calendly.com/old-client/meeting','${admin}');
    delete from public.project_stages where project_id='${source}';
    insert into public.project_stages(project_id,key,label,position,archived_at) values
      ('${source}','${customStage}','Services coordination',0,null),
      ('${source}','planning','Brief and site plan',7,null),
      ('${source}','retired','Old removed group',9,now());
    update public.projects set current_stage='planning',stage_revision=4 where id='${source}';
    insert into public.project_members(project_id,user_id,access) values('${source}','${client}','client'),('${source}','${partner}','partner');
    insert into public.tasks(id,project_id,title,description,stage,status,priority,assignee_id,start_date,due_date,position,created_by,source_id,source_metadata) values
      ('${sourceTask}','${source}','Measure the dining room','Record circulation and table dimensions','planning','in_progress','high','${client}','2026-01-01','2026-01-02',5.5,'${admin}','OLD-T01','{"old_source":"old-client-plan"}'),
      ('${secondTask}','${source}','Coordinate kitchen services','Record service points','${customStage}','blocked','medium','${partner}','2026-01-02','2026-01-05',9,'${admin}',null,'{}');
    update public.tasks set status='done' where id='${sourceTask}';
    insert into public.task_approval_plan(project_id,task_id,source_id,stage_gate,milestone,description,source_metadata)
      values('${source}','${sourceTask}','OLD-REVIEW','Brief and site plan','Plan review','Review the dimensions','{"old_workbook":"old-client-file"}');
    insert into public.comments(project_id,task_id,user_id,body) values('${source}','${sourceTask}','${client}','Private source discussion');
    insert into storage.objects(bucket_id,name,metadata)
      values('project-files','${source}/private-old-drawing.pdf','{"size":123,"mimetype":"application/pdf"}');
    insert into public.documents(project_id,task_id,name,path,size,uploaded_by)
      values('${source}','${sourceTask}','Private old drawing.pdf','${source}/private-old-drawing.pdf',123,'${admin}');
    insert into public.project_daily_updates(project_id,work_done,created_by) values('${source}','Private source daily note','${admin}');
  `);
  await db.exec("begin");
  const approval = (await actor<{ id: string }>(admin, "select id from public.request_task_approval($1)", [sourceTask])).rows[0]!;
  await actor(client, "select public.respond_task_approval($1,'approved','Approved source work')", [approval.id]);
  await actor(admin, "select public.save_project_finance($1,0,$2::jsonb,'[]'::jsonb)", [source, {
    total_minor: 100000, currency: "INR", quote_label: "Old private agreement", scope_notes: "Old project scope", payment_instructions: "Old bank details", partner_summary_visible: false,
  }]);
  await actor(admin, "select public.record_project_payment($1,$2::jsonb,'[]'::jsonb)", [source, {
    id: randomUUID(), kind: "receipt", purpose: "advance", amount_minor: 1000, paid_on: "2026-01-01", method: "Bank transfer", reference: "OLD-PRIVATE-PAYMENT", notes: "Old client payment", proof_path: null, related_payment_id: null,
  }]);
  await db.exec("commit");
}, 30_000);

beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db?.close(); });

async function actor<T = Record<string, unknown>>(id: string | null, query: string, args: unknown[] = []) {
  await db.exec("savepoint duplicate_actor");
  try {
    await db.exec(`set local role ${id ? "authenticated" : "anon"}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id ?? ""]);
    const result = await db.query<T>(query, args);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub','',true)");
    await db.exec("release savepoint duplicate_actor");
    return result;
  } catch (error) {
    await db.exec("rollback to savepoint duplicate_actor; release savepoint duplicate_actor");
    throw error;
  }
}

async function copy(requestId = randomUUID(), fields: Record<string, unknown> = { name: "New restaurant" }, id: string | null = admin, sourceId = source) {
  const result = await actor<{ value: CopyResult }>(id, "select public.duplicate_project($1,$2,$3::jsonb) value", [sourceId, requestId, fields]);
  return result.rows[0]!.value;
}
async function count(table: string, projectId: string) {
  return (await db.query<{ count: number }>(`select count(*)::int count from public.${table} where project_id=$1`, [projectId])).rows[0]!.count;
}

describe("duplicate project plan", () => {
  it("creates fresh progress from active headings and all tasks without copying a client's history or access", async () => {
    const created = await copy();
    expect(created).toMatchObject({ created: true, task_count: 2, approval_plan_count: 1, stage_count: 2 });
    const project = (await db.query("select * from public.projects where id=$1", [created.project_id])).rows[0]!;
    expect(project).toMatchObject({ name: "New restaurant", current_stage: customStage, status: "active", stage_revision: 0, client_name: null, client_brand: null, client_email: null, location: null, description: null, start_date: null, target_date: null, meeting_url: null, created_by: admin });
    const stages = (await db.query("select key,label,position,archived_at from public.project_stages where project_id=$1 order by position,key", [created.project_id])).rows;
    expect(stages).toEqual([{ key: customStage, label: "Services coordination", position: 0, archived_at: null }, { key: "planning", label: "Brief and site plan", position: 7, archived_at: null }]);
    const tasks = (await db.query<Record<string, unknown>>("select * from public.tasks where project_id=$1 order by position", [created.project_id])).rows;
    expect(tasks.map((row) => ({ title: row["title"], description: row["description"], stage: row["stage"], priority: row["priority"], position: row["position"] }))).toEqual([
      { title: "Measure the dining room", description: "Record circulation and table dimensions", stage: "planning", priority: "high", position: 5.5 },
      { title: "Coordinate kitchen services", description: "Record service points", stage: customStage, priority: "medium", position: 9 },
    ]);
    for (const task of tasks) {
      expect(task).toMatchObject({ status: "not_started", assignee_id: null, start_date: null, due_date: null, content_revision: 1, source_id: null, source_metadata: {}, created_by: admin });
      expect([sourceTask, secondTask]).not.toContain(task["id"]);
    }
    const plan = (await db.query<Record<string, unknown>>("select * from public.task_approval_plan where project_id=$1", [created.project_id])).rows[0]!;
    expect(plan).toMatchObject({ task_id: tasks[0]!["id"], stage_gate: "Brief and site plan", milestone: "Plan review", description: "Review the dimensions", source_metadata: {} });
    expect(plan["source_id"]).not.toBe("OLD-REVIEW");
    for (const table of ["project_members", "comments", "documents", "task_approvals", "project_daily_updates", "project_finance", "project_payment_milestones", "project_payments", "project_payment_allocations", "project_finance_audit", "project_imports"]) {
      expect(await count(table, created.project_id), table).toBe(0);
    }
    expect((await db.query("select name from storage.objects where bucket_id='project-files' and name like $1", [`${created.project_id}/%`])).rows).toEqual([]);
    expect((await db.query("select name from storage.objects where bucket_id='project-files' and name=$1", [`${source}/private-old-drawing.pdf`])).rows).toHaveLength(1);
    const activity = (await db.query<{ kind: string; payload: { status?: string; historical?: boolean } }>("select kind,payload from public.project_activity where project_id=$1", [created.project_id])).rows;
    expect(activity.filter((entry) => entry.kind === "task_created")).toHaveLength(2);
    expect(activity.every((entry) => ["task_created", "project_updated"].includes(entry.kind))).toBe(true);
    expect(activity.filter((entry) => entry.kind === "task_created").every((entry) => entry.payload.status === "not_started" && !entry.payload.historical)).toBe(true);
    expect(await count("task_approvals", source)).toBe(1);
    expect(await count("project_payments", source)).toBe(1);
    expect((await db.query("select status,source_id from public.tasks where id=$1", [sourceTask])).rows[0]).toEqual({ status: "done", source_id: "OLD-T01" });
  });

  it("uses only the new project details and never automatically adds an existing matching client account", async () => {
    const created = await copy(randomUUID(), { name: " New office ", client_name: "New Contact", client_brand: "New Brand", client_email: "CLIENT@EXAMPLE.TEST", location: "New site", project_type: "Office", description: "New project notes" });
    expect((await db.query("select name,client_name,client_brand,client_email,location,project_type,description from public.projects where id=$1", [created.project_id])).rows[0]).toEqual({ name: "New office", client_name: "New Contact", client_brand: "New Brand", client_email: "client@example.test", location: "New site", project_type: "Office", description: "New project notes" });
    expect(await count("project_members", created.project_id)).toBe(0);
  });

  it("returns the same copy after source/target edits and rejects a changed or foreign request", async () => {
    const request = randomUUID(), fields = { name: "Retry-safe project" };
    const first = await copy(request, fields);
    await db.query("update public.projects set name='Edited copy' where id=$1", [first.project_id]);
    await db.query("update public.tasks set title='New source task wording' where id=$1", [sourceTask]);
    const retried = await copy(request, fields);
    expect(retried).toEqual({ ...first, created: false });
    expect((await db.query("select name from public.projects where id=$1", [first.project_id])).rows[0]).toEqual({ name: "Edited copy" });
    expect((await db.query("select title from public.tasks where project_id=$1 order by position limit 1", [first.project_id])).rows[0]).toEqual({ title: "Measure the dining room" });
    await expect(copy(request, { name: "Changed request" })).rejects.toMatchObject({ code: "23505" });
    await expect(copy(request, fields, otherAdmin)).rejects.toMatchObject({ code: "42501" });
    expect((await db.query<{ count: number }>("select count(*)::int count from portal_duplication_private.requests where request_id=$1", [request])).rows[0]!.count).toBe(1);
  });

  it("denies partners, clients and anonymous callers and hides the operation ledger", async () => {
    for (const user of [partner, client, null]) await expect(copy(randomUUID(), { name: "Forbidden copy" }, user)).rejects.toMatchObject({ code: "42501" });
    await expect(copy(randomUUID(), { name: "Missing source" }, admin, randomUUID())).rejects.toMatchObject({ code: "42501" });
    await expect(actor(client, "select * from portal_duplication_private.requests")).rejects.toMatchObject({ code: "42501" });
    await expect(actor(client, "select public.duplicate_project($1,null,$2::jsonb)", [source, { name: "Invalid request" }])).rejects.toMatchObject({ code: "42501" });
  });

  it("rolls back the project, tasks, fresh activity and request ledger together on an insertion failure", async () => {
    await db.exec(`create function public.reject_duplicate_test_task() returns trigger language plpgsql as $$
      begin if new.project_id<>'${source}'::uuid and new.title='Coordinate kitchen services' then raise exception 'Simulated task insertion failure'; end if; return new; end $$;
      create trigger zz_reject_duplicate_test_task before insert on public.tasks for each row execute function public.reject_duplicate_test_task();`);
    const counts = (await db.query("select (select count(*) from public.projects) projects,(select count(*) from public.tasks) tasks,(select count(*) from public.project_activity) activity")).rows[0];
    const request = randomUUID();
    await expect(copy(request)).rejects.toThrow("Simulated task insertion failure");
    expect((await db.query("select (select count(*) from public.projects) projects,(select count(*) from public.tasks) tasks,(select count(*) from public.project_activity) activity")).rows[0]).toEqual(counts);
    expect((await db.query("select * from portal_duplication_private.requests where request_id=$1", [request])).rows).toEqual([]);
  });

  it("does not recreate a removed copy when its old request is retried", async () => {
    const request = randomUUID(), fields = { name: "Removed copy" };
    const created = await copy(request, fields);
    await db.query("delete from public.projects where id=$1", [created.project_id]);
    await expect(copy(request, fields)).rejects.toMatchObject({ code: "55000" });
    expect((await db.query("select id from public.projects where name='Removed copy'")).rows).toEqual([]);
  });

  it("rejects blank/invalid metadata and fields that would carry work or client access into the copy", async () => {
    for (const fields of [{ name: " " }, { name: "New", client_email: "bad email" }, { name: "New", project_type: "Invalid" }, { name: "New", status: "completed" }, { name: "New", client_user_id: client }, { name: "New", name_object: {} }]) {
      await expect(copy(randomUUID(), fields)).rejects.toMatchObject({ code: "22023" });
    }
  });
});
