// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FinanceBundle } from "../lib/project-finance";

const admin = "00000000-0000-0000-0000-000000000001";
const partner = "00000000-0000-0000-0000-000000000002";
const client = "00000000-0000-0000-0000-000000000003";
const outsider = "00000000-0000-0000-0000-000000000004";
const otherClient = "00000000-0000-0000-0000-000000000005";
const project = "10000000-0000-0000-0000-000000000001";
const otherProject = "10000000-0000-0000-0000-000000000002";
const task = "20000000-0000-0000-0000-000000000001";
const documentId = "30000000-0000-0000-0000-000000000001";
const documentPath = `${project}/${documentId}/proposal.pdf`;
let db: PGlite;

// Run real Postgres grants, RLS, PL/pgSQL and triggers. Only the managed
// Supabase auth/storage infrastructure is stubbed; application SQL is unchanged.
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;
    grant usage on schema public, auth, storage to authenticated, anon, service_role;
    create table auth.users (
      id uuid primary key, email text, email_confirmed_at timestamptz,
      raw_user_meta_data jsonb not null default '{}'
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table storage.buckets (id text primary key, name text, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (
      id uuid primary key default gen_random_uuid(), bucket_id text not null,
      name text not null, metadata jsonb default '{}', unique(bucket_id, name)
    );
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select string_to_array(name, '/')
    $$;
    grant all on storage.objects to authenticated, service_role;
    alter table storage.objects enable row level security;
    insert into storage.buckets(id,name,public,file_size_limit) values ('project-files','project-files',false,52428800);
  `);
  for (const file of ["0000_migration.sql", "0001_migration.sql"]) {
    await db.exec(await readFile(resolve("drizzle/migrations", file), "utf8"));
  }
  const migrations = (await readdir(resolve("supabase/migrations"))).filter((file) => file.endsWith(".sql")).sort();
  for (const file of migrations) {
    await db.exec(await readFile(resolve("supabase/migrations", file), "utf8"));
  }
  await db.exec(`
    insert into auth.users (id,email,email_confirmed_at) values
      ('${admin}','admin@example.test',now()), ('${partner}','partner@example.test',now()),
      ('${client}','client@example.test',now()), ('${outsider}','outsider@example.test',now()),
      ('${otherClient}','other@example.test',now());
    insert into public.user_roles (user_id,role) values ('${partner}','partner'),('${client}','client'),('${outsider}','client');
    insert into public.projects(id,name) values ('${project}','Project A'),('${otherProject}','Project B');
    insert into public.project_members(project_id,user_id,access) values
      ('${project}','${partner}','partner'),('${project}','${client}','client'),
      ('${project}','${otherClient}','client'),('${otherProject}','${outsider}','client'),
      ('${project}','${admin}','client');
    insert into public.tasks(id,project_id,title,description,stage) values
      ('${task}','${project}','Kitchen layout','Choose the kitchen layout','planning');
  `);
}, 30_000);

beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db?.close(); });

async function asActor<T = Record<string, unknown>>(actor: string | null, sql: string, args: unknown[] = []) {
  await db.exec("savepoint actor_call");
  try {
    await db.exec(`set local role ${actor ? "authenticated" : "anon"}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [actor ?? ""]);
    const result = await db.query<T>(sql, args);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', true)");
    await db.exec("release savepoint actor_call");
    return result;
  } catch (error) {
    await db.exec("rollback to savepoint actor_call; release savepoint actor_call");
    throw error;
  }
}

function firstRow<T>({ rows }: { rows: T[] }): T {
  const row = rows[0];
  if (row === undefined) throw new Error("Expected the database query to return a row");
  return row;
}

async function request(actor = partner) {
  const { rows } = await asActor<{ id: string; revision: number; state: string; requested_by: string; snapshot: { documents: { id: string; path: string }[] } }>(
    actor, "select * from public.request_task_approval($1)", [task],
  );
  return firstRow({ rows });
}

async function attach() {
  await asActor(partner, "insert into storage.objects(bucket_id,name) values ('project-files',$1)", [documentPath]);
  await asActor(partner, "insert into public.documents(id,project_id,task_id,name,path,uploaded_by) values ($1,$2,$3,'proposal.pdf',$4,$5)", [documentId, project, task, documentPath, partner]);
}

describe("published daily project updates", () => {
  const publish = (actor: string, projectId = project, workDone = "Site measurements completed") =>
    asActor(actor, "insert into public.project_daily_updates(project_id,work_done) values ($1,$2) returning *", [projectId, workDone]);

  it("lets project editors publish and project clients read, while denying client and outsider publication", async () => {
    const report = firstRow(await publish(partner));
    expect(report).toMatchObject({ project_id: project, work_done: "Site measurements completed", created_by: partner, next_steps: "", blockers: "" });
    expect((await asActor(client, "select id from public.project_daily_updates where project_id=$1", [project])).rows).toEqual([{ id: report["id"] }]);
    expect((await asActor(outsider, "select id from public.project_daily_updates")).rows).toEqual([]);
    await expect(publish(client)).rejects.toThrow();
    await expect(publish(outsider)).rejects.toThrow();
    await expect(publish(partner, otherProject)).rejects.toThrow();
    await expect(asActor(null, "select id from public.project_daily_updates")).rejects.toThrow();
    await expect(asActor(null, "insert into public.project_daily_updates(project_id,work_done) values ($1,'Unauthenticated')", [project])).rejects.toThrow();
  });

  it("stamps the authenticated author and posting time and permits several reports for one work day", async () => {
    const result = await asActor(partner, `insert into public.project_daily_updates(project_id,work_done,created_by,created_at)
      values ($1,'  Furniture layout reviewed  ',$2,'2000-01-01')
      returning created_by, work_done, created_at > '2020-01-01'::timestamptz as server_time,
      report_date = (clock_timestamp() at time zone 'Asia/Kolkata')::date as india_today`, [project, outsider]);
    expect(result.rows[0]).toMatchObject({ created_by: partner, work_done: "Furniture layout reviewed", server_time: true, india_today: true });
    await publish(partner, project, "Kitchen dimensions confirmed");
    expect((await asActor(client, "select id from public.project_daily_updates where project_id=$1", [project])).rows).toHaveLength(2);
  });

  it("rejects blank, oversized and future-dated reports, while allowing explicit earlier work dates", async () => {
    await expect(publish(partner, project, " \n\t ")).rejects.toThrow();
    await expect(publish(partner, project, "x".repeat(10_001))).rejects.toThrow();
    await expect(asActor(partner, "insert into public.project_daily_updates(project_id,work_done,next_steps) values ($1,'Done',$2)", [project, "x".repeat(10_001)])).rejects.toThrow();
    await expect(asActor(partner, "insert into public.project_daily_updates(project_id,work_done,blockers) values ($1,'Done',$2)", [project, "x".repeat(10_001)])).rejects.toThrow();
    await expect(asActor(partner, `insert into public.project_daily_updates(project_id,work_done,report_date)
      values ($1,'Future report',(clock_timestamp() at time zone 'Asia/Kolkata')::date + 1)`, [project])).rejects.toThrow("cannot be dated in the future");
    await expect(asActor(partner, "insert into public.project_daily_updates(project_id,work_done,report_date) values ($1,'Invalid date','-infinity')", [project])).rejects.toThrow();
    expect((await asActor(partner, "insert into public.project_daily_updates(project_id,work_done,report_date) values ($1,'Earlier site work','2020-01-01') returning report_date::text", [project])).rows).toEqual([{ report_date: "2020-01-01" }]);
  });

  it("does not let authenticated users rewrite or remove a published report", async () => {
    const report = firstRow(await publish(partner));
    for (const actor of [partner, admin, client]) {
      await expect(asActor(actor, "update public.project_daily_updates set work_done='Rewritten' where id=$1", [report["id"]])).rejects.toThrow();
      await expect(asActor(actor, "delete from public.project_daily_updates where id=$1", [report["id"]])).rejects.toThrow();
    }
    expect((await asActor(client, "select work_done from public.project_daily_updates where id=$1", [report["id"]])).rows).toEqual([{ work_done: "Site measurements completed" }]);
  });

  it("shows the identity of a visible project's global-admin reporter without exposing other report authors", async () => {
    await db.query("delete from public.project_members where user_id=$1", [admin]);
    expect((await asActor(client, "select id from public.profiles where id=$1", [admin])).rows).toEqual([]);
    await publish(admin);
    expect((await asActor(client, "select id from public.profiles where id=$1", [admin])).rows).toEqual([{ id: admin }]);
    expect((await asActor(outsider, "select id from public.profiles where id=$1", [admin])).rows).toEqual([]);
    await publish(admin, otherProject);
    expect((await asActor(outsider, "select id from public.project_daily_updates")).rows).toHaveLength(1);
  });
});

describe("automatic immutable project activity", () => {
  it("records real task status transitions with the database actor and ignores no-op or revision-only updates", async () => {
    await asActor(partner, "update public.tasks set status='done' where id=$1", [task]);
    const changes = await asActor<{ actor_id: string; payload: { title: string; changes: { status: { from: string; to: string } } }; server_time: boolean }>(client,
      "select actor_id,payload,occurred_at > '2020-01-01'::timestamptz as server_time from public.project_activity where kind='task_updated' and source_id=$1", [task]);
    expect(changes.rows).toHaveLength(1);
    expect(changes.rows[0]).toMatchObject({ actor_id: partner, payload: { title: "Kitchen layout", changes: { status: { from: "not_started", to: "done" } } }, server_time: true });
    await asActor(partner, "update public.tasks set status='done',content_revision=999 where id=$1", [task]);
    await asActor(partner, "update public.tasks set position=900 where id=$1", [task]);
    expect((await asActor(client, "select id from public.project_activity where kind='task_updated' and source_id=$1", [task])).rows).toHaveLength(1);
  });

  it("keeps the event stream project-scoped and denies direct event forgery, rewriting and trigger execution", async () => {
    await asActor(partner, "update public.tasks set due_date='2026-11-25' where id=$1", [task]);
    expect((await asActor(outsider, "select id from public.project_activity where project_id=$1", [project])).rows).toEqual([]);
    await expect(asActor(null, "select id from public.project_activity")).rejects.toThrow();
    for (const actor of [admin, partner, client]) {
      await expect(asActor(actor, "insert into public.project_activity(project_id,kind,source_type,source_id,payload) values ($1,'task_updated','tasks',$2,'{}')", [project, task])).rejects.toThrow();
      await expect(asActor(actor, "update public.project_activity set occurred_at='2000-01-01' where project_id=$1", [project])).rejects.toThrow();
      await expect(asActor(actor, "delete from public.project_activity where project_id=$1", [project])).rejects.toThrow();
    }
    const privileges = await db.query("select has_function_privilege('authenticated','public.capture_project_activity()','EXECUTE') as api_execute, has_table_privilege('service_role','public.project_activity','INSERT') as service_insert");
    expect(privileges.rows[0]).toEqual({ api_execute: false, service_insert: false });
  });

  it("captures actual file uploads and removals once without manufacturing task completion or revision events", async () => {
    await attach();
    expect((await asActor(client, "select kind,payload->>'name' as name,actor_id from public.project_activity where source_type='documents' and source_id=$1", [documentId])).rows).toEqual([{ kind: "document_added", name: "proposal.pdf", actor_id: partner }]);
    expect((await asActor(client, "select id from public.project_activity where kind='task_updated'", [])).rows).toEqual([]);
    await asActor(partner, "delete from public.documents where id=$1", [documentId]);
    expect((await asActor(client, "select kind from public.project_activity where source_type='documents' and source_id=$1 order by occurred_at", [documentId])).rows).toEqual([{ kind: "document_added" }, { kind: "document_removed" }]);
  });

  it("labels client comments as comments and captures requests and real client decisions inside security-definer RPCs", async () => {
    await asActor(client, "insert into public.comments(project_id,task_id,user_id,body,created_at) values ($1,$2,$3,'Please adjust the kitchen plan','2000-01-01')", [project, task, client]);
    const comment = await asActor(client, "select kind,actor_id,payload->>'body' as body,occurred_at > '2020-01-01'::timestamptz as server_time from public.project_activity where source_type='comments'");
    expect(comment.rows[0]).toEqual({ kind: "comment_added", actor_id: client, body: "Please adjust the kitchen plan", server_time: true });
    const approval = await request();
    await asActor(client, "select * from public.respond_task_approval($1,'changes_requested','Move the sink')", [approval.id]);
    expect((await asActor(client, "select kind,actor_id,payload->>'feedback' as feedback from public.project_activity where source_id=$1 order by occurred_at", [approval.id])).rows).toEqual([
      { kind: "approval_requested", actor_id: partner, feedback: null }, { kind: "approval_changes_requested", actor_id: client, feedback: "Move the sink" },
    ]);
  });

  it("captures schedule and stage changes, preserves optional notes, and treats SQL operators as system actors", async () => {
    await asActor(partner, "update public.projects set current_stage='layout_2d',target_date='2027-01-15' where id=$1", [project]);
    expect((await asActor(client, "select payload->'changes'->'current_stage' as stage from public.project_activity where source_type='projects'", [])).rows).toEqual([{ stage: { from: "planning", to: "layout_2d" } }]);
    await asActor(partner, "insert into public.project_daily_updates(project_id,work_done) values ($1,'Optional site note')", [project]);
    expect((await asActor(client, "select kind,payload->>'work_done' as work_done from public.project_activity where source_type='project_daily_updates'")).rows).toEqual([{ kind: "team_note", work_done: "Optional site note" }]);
    await db.query("update public.tasks set status='blocked' where id=$1", [task]);
    expect((await asActor(client, "select actor_id from public.project_activity where kind='task_updated' and source_id=$1", [task])).rows).toEqual([{ actor_id: null }]);
  });

  it("rolls activity back with a failed write and does not break task or project cascading deletion", async () => {
    await db.exec("savepoint activity_rollback");
    await asActor(partner, "update public.tasks set status='done' where id=$1", [task]);
    await db.exec("rollback to savepoint activity_rollback; release savepoint activity_rollback");
    expect((await asActor(client, "select id from public.project_activity where kind='task_updated' and source_id=$1", [task])).rows).toEqual([]);
    await asActor(partner, "delete from public.tasks where id=$1", [task]);
    expect((await asActor(client, "select payload->>'title' as title from public.project_activity where kind='task_deleted' and source_id=$1", [task])).rows).toEqual([{ title: "Kitchen layout" }]);
    await asActor(admin, "delete from public.projects where id=$1", [project]);
    expect((await db.query("select id from public.project_activity where project_id=$1", [project])).rows).toEqual([]);
  });

  it("backfills only timestamped source records and never invents prior task completion history", async () => {
    // Rebuild only this new feature inside the test's rollback transaction so
    // the migration can be exercised against genuine pre-existing source rows.
    await db.exec("drop function public.capture_project_activity() cascade; drop table public.project_activity cascade; drop table public.project_activity_tracking cascade");
    await db.query("insert into public.documents(project_id,task_id,name,path,uploaded_by,created_at) values ($1,$2,'historic.pdf',$3,$4,'2000-01-01')", [project, task, `${project}/historic.pdf`, partner]);
    await db.query("insert into public.comments(project_id,user_id,body,created_at) values ($1,$2,'Historic client question','2001-01-01')", [project, client]);
    await db.query("insert into public.task_approvals(project_id,task_id,revision,snapshot,requested_by,requested_at,state,decided_by,decided_at) values ($1,$2,1,'{\"task\":{\"title\":\"Historic kitchen plan\"}}',$3,'2002-01-01','approved',$4,'2003-01-01')", [project, task, partner, client]);
    await db.query("insert into public.project_daily_updates(project_id,report_date,work_done,created_by,created_at) values ($1,'2004-01-01','Historic optional note',$2,'2004-01-01')", [project, partner]);
    await db.query("update public.tasks set status='done',updated_at='1999-01-01' where id=$1", [task]);
    await db.exec(await readFile(resolve("supabase/migrations/20261120105044_project_activity.sql"), "utf8"));
    const history = await asActor<{ kind: string; actor_id: string; historical: boolean }>(client, "select kind,actor_id,(payload->>'historical')::boolean as historical from public.project_activity order by occurred_at");
    expect(history.rows).toEqual([
      { kind: "document_added", actor_id: partner, historical: true }, { kind: "comment_added", actor_id: client, historical: true },
      { kind: "approval_requested", actor_id: partner, historical: true }, { kind: "approval_approved", actor_id: client, historical: true },
      { kind: "team_note", actor_id: partner, historical: true },
    ]);
    expect((await asActor(client, "select id from public.project_activity where source_type='tasks'")).rows).toEqual([]);
  });
});

describe("task approval authorization and immutable evidence", () => {
  it("allows editors to request and project clients to decide, using the database actor", async () => {
    const approval = await request();
    expect(approval).toMatchObject({ revision: 1, state: "pending", requested_by: partner });
    const result = await asActor(client, "select * from public.respond_task_approval($1,'approved','Accepted')", [approval.id]);
    expect(result.rows[0]).toMatchObject({ state: "approved", decided_by: client, feedback: "Accepted" });
    expect(firstRow(result)["decided_at"]).toBeTruthy();
  });

  it("denies outsider reads, requests and decisions, despite a global client role", async () => {
    const approval = await request();
    expect((await asActor(outsider, "select id from public.task_approvals")).rows).toEqual([]);
    await expect(asActor(outsider, "select * from public.request_task_approval($1)", [task])).rejects.toThrow();
    await expect(asActor(outsider, "select * from public.respond_task_approval($1,'approved')", [approval.id])).rejects.toThrow();
  });

  it("allows visible client reads but no direct approval or task writes", async () => {
    const approval = await request();
    expect((await asActor(client, "select id from public.task_approvals")).rows).toHaveLength(1);
    await expect(asActor(client, "update public.task_approvals set state='approved' where id=$1", [approval.id])).rejects.toThrow();
    await expect(asActor(partner, "delete from public.task_approvals where id=$1", [approval.id])).rejects.toThrow();
    expect((await asActor(client, "update public.tasks set title='Forged' where id=$1 returning id", [task])).rows).toEqual([]);
    await expect(asActor(client, "select * from public.request_task_approval($1)", [task])).rejects.toThrow();
    await expect(asActor(null, "select * from public.request_task_approval($1)", [task])).rejects.toThrow();
  });

  it("blocks editor decisions, self decisions and invalid decision values", async () => {
    const approval = await request();
    await expect(asActor(partner, "select * from public.respond_task_approval($1,'approved')", [approval.id])).rejects.toThrow();
    await expect(asActor(client, "select * from public.respond_task_approval($1,'pending')", [approval.id])).rejects.toThrow();
    // A global admin may also be a project client, but cannot approve their own request.
    const adminTask = "20000000-0000-0000-0000-000000000002";
    await db.query("insert into public.tasks(id,project_id,title) values ($1,$2,'Admin proposal')", [adminTask, project]);
    const own = await asActor<{ id: string }>(admin, "select * from public.request_task_approval($1)", [adminTask]);
    await expect(asActor(admin, "select * from public.respond_task_approval($1,'approved')", [firstRow(own).id])).rejects.toThrow();
  });

  it("requires an explanation for requested changes, including whitespace-only feedback", async () => {
    const approval = await request();
    for (const feedback of [null, "", " \n\t "]) {
      await expect(asActor(client, "select * from public.respond_task_approval($1,'changes_requested',$2)", [approval.id, feedback])).rejects.toThrow("Explain");
    }
    const result = await asActor(client, "select * from public.respond_task_approval($1,'changes_requested','Move the sink')", [approval.id]);
    expect(result.rows[0]).toMatchObject({ state: "changes_requested", feedback: "Move the sink", decided_by: client });
  });

  it("makes repeated requests idempotent and accepts only one decision", async () => {
    const approval = await request();
    expect((await request()).id).toBe(approval.id);
    await asActor(client, "select * from public.respond_task_approval($1,'changes_requested','Please revise the island')", [approval.id]);
    expect(await request()).toMatchObject({ id: approval.id, state: "changes_requested" });
    await expect(asActor(otherClient, "select * from public.respond_task_approval($1,'approved')", [approval.id])).rejects.toThrow();
  });

  it("invalidates pending decisions when content changes and preserves prior snapshots", async () => {
    const first = await request();
    await asActor(partner, "update public.tasks set title='Revised kitchen layout' where id=$1", [task]);
    await expect(asActor(client, "select * from public.respond_task_approval($1,'approved')", [first.id])).rejects.toThrow();
    const second = await request();
    expect(second.revision).toBe(2);
    expect(second.id).not.toBe(first.id);
    const history = await asActor<{ snapshot: { task: { title: string } } }>(client, "select snapshot from public.task_approvals where id=$1", [first.id]);
    expect(firstRow(history).snapshot.task.title).toBe("Kitchen layout");
    await asActor(client, "select * from public.respond_task_approval($1,'approved','Revised design accepted')", [second.id]);
    await asActor(partner, "update public.tasks set stage='layout_2d' where id=$1", [task]);
    const decidedHistory = await asActor(client, "select state,decided_by,feedback from public.task_approvals where id=$1", [second.id]);
    expect(decidedHistory.rows[0]).toMatchObject({ state: "approved", decided_by: client, feedback: "Revised design accepted" });
    expect((await request()).revision).toBe(3);
  });

  it("does not let editors forge content revisions, and status changes do not approve new content", async () => {
    await asActor(partner, "update public.tasks set content_revision=500,status='in_progress' where id=$1", [task]);
    expect((await request()).revision).toBe(1);
    await asActor(partner, "update public.tasks set description='New design',content_revision=700 where id=$1", [task]);
    expect((await request()).revision).toBe(2);
  });

  it("rejects direct task identity and provenance rewrites even from an authenticated admin", async () => {
    for (const [field, value] of [
      ["id", "20000000-0000-0000-0000-000000000099"], ["project_id", otherProject], ["created_by", outsider], ["created_at", "2000-01-01T00:00:00Z"],
      ["source_id", "forged-source"], ["source_metadata", '{"original":"forged"}'],
    ] as const) {
      await expect(asActor(admin, `update public.tasks set ${field}=$1 where id=$2`, [value, task])).rejects.toThrow("cannot be changed");
    }
    await expect(asActor(partner, "insert into public.tasks(project_id,title,source_id) values ($1,'Forged import','fake:1')", [project])).rejects.toThrow("Source provenance");
    await expect(asActor(partner, "insert into public.tasks(project_id,title,source_metadata) values ($1,'Forged import','{\"source\":\"fake\"}')", [project])).rejects.toThrow("Source provenance");
  });

  it("stamps direct task creation while preserving attribution in privileged migration writes", async () => {
    const inserted = await asActor(partner, "insert into public.tasks(project_id,title,created_by,created_at) values ($1,'New item',$2,'2000-01-01') returning created_by,created_at > '2020-01-01'::timestamptz as server_time", [project, outsider]);
    expect(inserted.rows[0]).toMatchObject({ created_by: partner, server_time: true });
    const restored = await db.query("insert into public.tasks(project_id,title,created_by,created_at,source_id,source_metadata) values ($1,'Restored item',$2,'2000-01-01','restored:1','{\"original\":true}') returning created_by,created_at = '2000-01-01'::timestamptz as original_time,source_id", [project, outsider]);
    expect(restored.rows[0]).toMatchObject({ created_by: outsider, original_time: true, source_id: "restored:1" });
  });

  it("increments revisions on attachment insertion and deletion", async () => {
    await attach();
    expect(firstRow(await db.query<{ content_revision: number }>("select content_revision from public.tasks where id=$1", [task])).content_revision).toBe(2);
    await asActor(partner, "delete from public.documents where id=$1", [documentId]);
    expect(firstRow(await db.query<{ content_revision: number }>("select content_revision from public.tasks where id=$1", [task])).content_revision).toBe(3);
  });

  it("stamps document upload attribution and time, while privileged restores retain originals", async () => {
    const inserted = await asActor(partner, "insert into public.documents(project_id,task_id,name,path,uploaded_by,created_at) values ($1,$2,'proposal.pdf',$3,$4,'2000-01-01') returning uploaded_by,created_at > '2020-01-01'::timestamptz as server_time", [project, task, documentPath, outsider]);
    expect(inserted.rows[0]).toMatchObject({ uploaded_by: partner, server_time: true });
    const restored = await db.query("insert into public.documents(project_id,task_id,name,path,uploaded_by,created_at) values ($1,$2,'restored.pdf',$3,$4,'2000-01-01') returning uploaded_by,created_at = '2000-01-01'::timestamptz as original_time", [project, task, `${project}/restored.pdf`, outsider]);
    expect(restored.rows[0]).toMatchObject({ uploaded_by: outsider, original_time: true });
  });

  it("retains snapshotted document metadata and storage objects, including privileged deletion", async () => {
    await attach();
    const approval = await request();
    expect(approval.snapshot.documents[0]).toMatchObject({ id: documentId, path: documentPath });
    expect((await asActor(partner, "delete from public.documents where id=$1 returning id", [documentId])).rows).toEqual([]);
    expect((await asActor(partner, "delete from storage.objects where name=$1 returning id", [documentPath])).rows).toEqual([]);
    // Restrictive policies also have trigger guards for bypass-RLS paths and races.
    await db.exec("savepoint evidence_delete");
    await expect(db.query("delete from public.documents where id=$1", [documentId])).rejects.toThrow();
    await db.exec("rollback to savepoint evidence_delete; release savepoint evidence_delete");
    await db.exec("savepoint evidence_storage");
    await expect(db.query("delete from storage.objects where name=$1", [documentPath])).rejects.toThrow();
    await db.exec("rollback to savepoint evidence_storage; release savepoint evidence_storage");
  });

  it("retains approval history when an editor deletes its task or an admin deletes its project", async () => {
    await request();
    await expect(asActor(partner, "delete from public.tasks where id=$1", [task])).rejects.toThrow();
    await expect(asActor(admin, "delete from public.projects where id=$1", [project])).rejects.toThrow();
  });

  it("rejects mismatched document/task project IDs", async () => {
    await expect(asActor(admin, "insert into public.documents(project_id,task_id,name,path) values ($1,$2,'Wrong project','bad')", [otherProject, task])).rejects.toThrow();
    await expect(asActor(outsider, "insert into public.comments(project_id,task_id,user_id,body) values ($1,$2,$3,'Wrong task')", [otherProject, task, outsider])).rejects.toThrow();
  });

  it("shows visible project authors without revealing unrelated admins", async () => {
    const writer = "00000000-0000-0000-0000-000000000006";
    const unrelated = "00000000-0000-0000-0000-000000000007";
    await db.query("insert into auth.users(id,email) values ($1,'writer@example.test'),($2,'unrelated@example.test')", [writer, unrelated]);
    await db.query("insert into public.user_roles(user_id,role) values ($1,'admin'),($2,'admin')", [writer, unrelated]);
    await asActor(writer, "insert into public.comments(project_id,user_id,body) values ($1,$2,'Site update')", [project, writer]);
    await asActor(unrelated, "insert into public.comments(project_id,user_id,body) values ($1,$2,'Other site update')", [otherProject, unrelated]);
    const visible = await asActor(client, "select id from public.profiles where id in ($1,$2)", [writer, unrelated]);
    expect(visible.rows).toEqual([{ id: writer }]);
  });
});

const sourceHash = "a".repeat(64);
function importPayload(email = "client@example.test", name = "Imported kitchen") {
  return [
    { name, client_name: "Mamta", client_brand: "RCF", client_email: email, location: "Kharar", project_type: "Restaurant", meeting_url: "https://calendly.com/spacenez/review" },
    [{ source_id: "tasks:2", title: "Kitchen options", description: "Source task", stage: "planning", status: "not_started", priority: "medium", position: 0, start_date: null, due_date: null, source_metadata: { source_row: 2, owner: null } }],
    [{ source_id: "options-approvals:6", task_source_id: "tasks:2", stage_gate: "Planning", milestone: "Kitchen options", description: "Client to select", source_metadata: { status: "Pending", approval_date: null } }],
    sourceHash,
  ];
}
async function importPlan(actor = admin, payload = importPayload()) {
  const result = await asActor<{ result: { project_id: string; created: boolean; task_count: number; approval_plan_count: number; client_linked: boolean } }>(actor,
    "select public.import_project_plan($1::jsonb,$2::jsonb,$3::jsonb,$4::text) as result",
    payload.map((value, index) => index < 3 ? JSON.stringify(value) : value),
  );
  return firstRow(result).result;
}

describe("atomic project-plan import", () => {
  it("imports plans without fabricating decisions or accounts and links only a verified existing client", async () => {
    const result = await importPlan();
    expect(result).toMatchObject({ created: true, task_count: 1, approval_plan_count: 1, client_linked: true });
    expect((await db.query("select * from public.task_approvals where project_id=$1", [result.project_id])).rows).toEqual([]);
    expect((await db.query("select id from auth.users")).rows).toHaveLength(5);
    const importedTask = await db.query("select assignee_id,start_date,due_date,source_metadata from public.tasks where project_id=$1", [result.project_id]);
    expect(importedTask.rows[0]).toMatchObject({ assignee_id: null, start_date: null, due_date: null, source_metadata: { source_row: 2, owner: null } });
    const planned = await db.query<{ source_metadata: { status: string; approval_date: null } }>("select source_metadata from public.task_approval_plan where project_id=$1", [result.project_id]);
    expect(firstRow(planned).source_metadata).toEqual({ status: "Pending", approval_date: null });
  });

  it("deduplicates retries without overwriting later edits, while allowing the template for a different client", async () => {
    const first = await importPlan();
    await asActor(admin, "update public.tasks set title='Edited after import' where project_id=$1", [first.project_id]);
    const retry = await importPlan();
    expect(retry).toMatchObject({ project_id: first.project_id, created: false });
    expect(firstRow(await db.query<{ title: string }>("select title from public.tasks where project_id=$1", [first.project_id])).title).toBe("Edited after import");
    const other = await importPlan(admin, importPayload("other@example.test"));
    expect(other.project_id).not.toBe(first.project_id);
  });

  it("denies non-admin imports and rolls back the entire project on an invalid plan reference", async () => {
    await expect(importPlan(partner)).rejects.toThrow();
    const invalid = importPayload();
    firstRow({ rows: invalid[2] as { task_source_id: string }[] }).task_source_id = "does-not-exist";
    await expect(importPlan(admin, invalid)).rejects.toThrow();
    expect((await db.query("select id from public.projects")).rows).toHaveLength(2);
    expect((await db.query("select id from public.project_imports")).rows).toEqual([]);
  });

  it("does not trust an editable profile email or an unverified auth email for membership", async () => {
    await db.query("update public.profiles set email='victim@example.test' where id=$1", [outsider]);
    expect((await importPlan(admin, importPayload("victim@example.test"))).client_linked).toBe(false);
    await db.query("update auth.users set email_confirmed_at=null where id=$1", [otherClient]);
    expect((await importPlan(admin, importPayload("other@example.test"))).client_linked).toBe(false);
  });

  it("accepts Calendly hosts and rejects deceptive or insecure meeting URLs", async () => {
    for (const url of ["http://calendly.com/review", "https://calendly.com.evil.test/review", "https://user@calendly.com/review", "https://calendly.com:8443/review"]) {
      await expect(asActor(admin, "update public.projects set meeting_url=$1 where id=$2", [url, project])).rejects.toThrow();
    }
    await asActor(admin, "update public.projects set meeting_url='https://team.calendly.com/review' where id=$1", [project]);
  });
});

describe("private project finance and offline payment ledger", () => {
  const milestoneOne = "50000000-0000-0000-0000-000000000001";
  const milestoneTwo = "50000000-0000-0000-0000-000000000002";
  const paymentOne = "60000000-0000-0000-0000-000000000001";
  const paymentTwo = "60000000-0000-0000-0000-000000000002";
  const paymentThree = "60000000-0000-0000-0000-000000000003";
  const plan = (extra: Record<string, unknown> = {}) => ({
    total_minor: 1_000_000, currency: "INR", quote_label: "Agreed interior work",
    scope_notes: "Private commercial scope", payment_instructions: "Private bank instructions",
    partner_summary_visible: false, ...extra,
  });
  const milestones = () => [
    { id: milestoneOne, label: "Mobilisation", amount_minor: 600_000, due_date: null, due_condition: "Admin marks this due", position: 0, is_due: true },
    { id: milestoneTwo, label: "Handover", amount_minor: 400_000, due_date: null, due_condition: "After agreed handover", position: 1, is_due: false },
  ] satisfies [Record<string, unknown>, Record<string, unknown>];
  const payment = (id = paymentOne, extra: Record<string, unknown> = {}) => ({
    id, kind: "receipt", purpose: "advance", amount_minor: 300_000, paid_on: "2020-01-01",
    method: "Bank transfer", reference: "PRIVATE-REFERENCE", notes: "Initial advance received offline",
    proof_path: null, related_payment_id: null, ...extra,
  });
  const allocation = (amount = 100_000, milestoneId = milestoneOne) => ({ milestone_id: milestoneId, amount_minor: amount });
  const save = async (actor = admin, version = 0, planValue = plan(), milestoneValues: Record<string, unknown>[] = milestones(), projectId = project) =>
    firstRow(await asActor<{ result: FinanceBundle }>(actor, "select public.save_project_finance($1,$2,$3::jsonb,$4::jsonb) as result",
      [projectId, version, JSON.stringify(planValue), JSON.stringify(milestoneValues)])).result;
  const get = async (actor: string | null = admin, projectId = project) =>
    firstRow(await asActor<{ result: FinanceBundle }>(actor, "select public.get_project_finance($1) as result", [projectId])).result;
  const record = async (actor = admin, value = payment(), allocations: Record<string, unknown>[] = [], projectId = project) =>
    firstRow(await asActor<{ result: FinanceBundle }>(actor, "select public.record_project_payment($1,$2::jsonb,$3::jsonb) as result",
      [projectId, JSON.stringify(value), JSON.stringify(allocations)])).result;
  const review = async (id = paymentOne, decision = "confirm", reason = "", allocations: Record<string, unknown>[] | null = null, actor = admin) =>
    firstRow(await asActor<{ result: FinanceBundle }>(actor, "select public.review_project_payment($1,$2,$3,$4::jsonb) as result",
      [id, decision, reason, allocations === null ? null : JSON.stringify(allocations)])).result;
  const allocate = async (id = paymentOne, allocations: Record<string, unknown>[] = [], actor = admin) =>
    firstRow(await asActor<{ result: FinanceBundle }>(actor, "select public.allocate_project_payment($1,$2::jsonb) as result", [id, JSON.stringify(allocations)])).result;
  const upload = (actor = client, path = `${project}/${actor}/${paymentOne}-receipt.pdf`, metadata: Record<string, unknown> = { size: 100, mimetype: "application/pdf" }) =>
    asActor(actor, "insert into storage.objects(bucket_id,name,metadata) values ('project-finance',$1,$2::jsonb) returning id", [path, JSON.stringify(metadata)]);
  const operator = async (sql: string, args: unknown[]) => {
    await db.exec("savepoint storage_operator");
    try {
      await db.exec("set local role service_role");
      const result = await db.query(sql, args);
      await db.exec("reset role; release savepoint storage_operator");
      return result;
    } catch (error) {
      await db.exec("rollback to savepoint storage_operator; release savepoint storage_operator");
      throw error;
    }
  };

  it("starts unset, denies outsiders, and keeps financial authority separate from project editing", async () => {
    for (const actor of [admin, client]) expect(await get(actor)).toMatchObject({ configured: false, plan: null, summary: null, payments: [] });
    expect(await get(partner)).toMatchObject({ access: "restricted", configured: false, plan: null });
    for (const actor of [outsider, null]) await expect(get(actor)).rejects.toThrow();
    for (const actor of [partner, client, outsider]) await expect(save(actor)).rejects.toThrow();
    await expect(record()).rejects.toThrow("Configure");
    await save();
    for (const actor of [partner, outsider]) {
      expect((await asActor(actor, "select project_id from public.project_finance")).rows).toEqual([]);
      expect((await asActor(actor, "select id from public.project_payment_milestones")).rows).toEqual([]);
      await expect(record(actor)).rejects.toThrow();
    }
    for (const actor of [admin, client]) {
      await expect(asActor(actor, "update public.project_finance set total_minor=1 where project_id=$1", [project])).rejects.toThrow();
      await expect(asActor(actor, "delete from public.project_finance where project_id=$1", [project])).rejects.toThrow();
    }
  });

  it("accepts empty or partial schedules, validates integer money and saves plans atomically with a version guard", async () => {
    expect((await save(admin, 0, plan(), [])).plan?.version).toBe(1);
    await expect(save()).rejects.toThrow("changed");
    await expect(save(admin, 1, plan({ total_minor: 0 }), [])).rejects.toThrow();
    await expect(save(admin, 1, plan({ total_minor: 1.5 }), [])).rejects.toThrow();
    await expect(save(admin, 1, plan({ total_minor: 1_000_000_000_001 }), [])).rejects.toThrow();
    await expect(save(admin, 1, plan({ currency: "USD" }), [])).rejects.toThrow();
    await expect(save(admin, 1, plan(), [{ ...milestones()[0], amount_minor: 1_000_001 }])).rejects.toThrow("exceed");
    await expect(save(admin, 1, plan(), [{ ...milestones()[0], amount_minor: 0 }])).rejects.toThrow();
    await expect(save(admin, 1, plan(), [milestones()[0], milestones()[0]])).rejects.toThrow("unique");
    expect((await get()).plan?.version).toBe(1);
    const saved = await save(admin, 1, plan(), [milestones()[0]]);
    expect(saved.plan?.version).toBe(2);
    expect(saved.milestones).toHaveLength(1);
    expect(saved.summary).toMatchObject({ outstanding_minor: 1_000_000, due_now_minor: 600_000 });
  });

  it("counts confirmed offline advances once and applies unallocated credit against due milestones", async () => {
    await save();
    const first = await record();
    expect(first.summary).toMatchObject({ received_minor: 300_000, net_received_minor: 300_000, unallocated_minor: 300_000, outstanding_minor: 700_000, due_now_minor: 300_000 });
    expect(first.payments[0]).toMatchObject({ status: "confirmed", created_by: admin, verified_by: admin, paid_on: "2020-01-01" });
    expect(first.payments[0]).not.toHaveProperty("request_payload");
    const retry = await record();
    expect(retry.payments).toHaveLength(1);
    expect(retry.audit).toHaveLength(first.audit.length);
    await expect(record(admin, payment(paymentOne, { amount_minor: 300_001 }))).rejects.toThrow("already used");
    await expect(record(admin, payment(paymentOne, { notes: "different" }))).rejects.toThrow("already used");
    expect((await get()).summary?.received_minor).toBe(300_000);
  });

  it("treats client reports as pending until an admin verifies and prevents forged authority or allocation", async () => {
    await save();
    const pending = await record(client, payment(paymentOne, { amount_minor: 200_000 }));
    expect(pending.payments[0]).toMatchObject({ status: "reported", created_by: client, verified_by: null, verified_at: null });
    expect(pending.summary).toMatchObject({ pending_minor: 200_000, received_minor: 0, outstanding_minor: 1_000_000, due_now_minor: 600_000 });
    expect(pending.audit).toEqual([]);
    await expect(record(client, payment(paymentTwo), [allocation()])).rejects.toThrow("admin");
    expect((await get()).milestones.every((row) => !row.has_history)).toBe(true);
    await expect(record(client, payment(paymentTwo, { status: "confirmed" }))).rejects.toThrow("Unsupported");
    await expect(record(client, payment(paymentTwo, { created_by: admin }))).rejects.toThrow("Unsupported");
    await expect(record(client, payment(paymentTwo, { kind: "refund", related_payment_id: paymentOne }))).rejects.toThrow();
    for (const actor of [client, partner, outsider]) await expect(review(paymentOne, "confirm", "", null, actor)).rejects.toThrow();
    const confirmed = await review(paymentOne, "confirm", "Verified against bank", [allocation(100_000)]);
    expect(confirmed.summary).toMatchObject({ pending_minor: 0, received_minor: 200_000, unallocated_minor: 100_000, due_now_minor: 400_000 });
    expect(confirmed.milestones[0]).toMatchObject({ paid_minor: 100_000, has_history: true });
    expect(confirmed.payments[0]).toMatchObject({ status: "confirmed", created_by: client, verified_by: admin, review_reason: "Verified against bank" });
    const repeated = await review(paymentOne, "confirm", "Verified against bank", [allocation(100_000)]);
    expect(repeated.audit).toHaveLength(confirmed.audit.length);
    await expect(review(paymentOne, "confirm", "Changed reason")).rejects.toThrow();
  });

  it("requires reasons for rejection and voiding and does not turn rejected reports into paid money", async () => {
    await save();
    await record(client);
    await expect(review(paymentOne, "reject")).rejects.toThrow("reason");
    await expect(review(paymentOne, "void")).rejects.toThrow("reason");
    const rejected = await review(paymentOne, "reject", "Reference not found");
    expect(rejected.summary).toMatchObject({ received_minor: 0, pending_minor: 0 });
    expect(rejected.payments[0]?.status).toBe("rejected");
    expect((await review(paymentOne, "reject", "Reference not found")).audit).toHaveLength(rejected.audit.length);
    await expect(review(paymentOne, "confirm")).rejects.toThrow();
    await record(admin, payment(paymentTwo));
    const voided = await review(paymentTwo, "void", "Duplicate manual entry");
    expect(voided.summary).toMatchObject({ received_minor: 0, pending_minor: 0 });
    expect((await review(paymentTwo, "void", "Duplicate manual entry")).audit).toHaveLength(voided.audit.length);
  });

  it("splits an advance over several milestones, preserves history, and rolls back invalid reallocations", async () => {
    await save();
    await record(admin, payment(paymentOne, { amount_minor: 500_000 }), [allocation(200_000), allocation(100_000, milestoneTwo)]);
    expect((await get()).summary?.unallocated_minor).toBe(200_000);
    await expect(allocate(paymentOne, [allocation(500_001)])).rejects.toThrow("Allocations exceed");
    await expect(allocate(paymentOne, [allocation(100_000), allocation(100_000)])).rejects.toThrow("once");
    expect((await get()).milestones.map((row) => row.paid_minor)).toEqual([200_000, 100_000]);
    await expect(save(admin, 1, plan(), [milestones()[0]])).rejects.toThrow("history");
    await expect(save(admin, 1, plan(), [{ ...milestones()[0], amount_minor: 199_999 }, milestones()[1]])).rejects.toThrow("Confirmed milestone");
    const changed = await allocate(paymentOne, [allocation(300_000), allocation(200_000, milestoneTwo)]);
    expect(changed.summary?.unallocated_minor).toBe(0);
    expect(changed.milestones.map((row) => row.paid_minor)).toEqual([300_000, 200_000]);
    await allocate(paymentOne, []);
    await expect(save(admin, 1, plan(), [])).rejects.toThrow("history");
    await expect(allocate(paymentOne, [], client)).rejects.toThrow();
  });

  it("rejects overfunded and cross-project allocations without changing either project", async () => {
    await save();
    const foreign = "50000000-0000-0000-0000-000000000003";
    await save(admin, 0, plan(), [{ ...milestones()[0], id: foreign }], otherProject);
    await expect(record(admin, payment(), [allocation(100, foreign)])).rejects.toThrow("this project");
    await record(admin, payment(paymentOne, { amount_minor: 600_000 }), [allocation(600_000)]);
    await expect(record(admin, payment(paymentTwo, { amount_minor: 1 }), [allocation(1)])).rejects.toThrow("Confirmed milestone");
    await expect(save(admin, 1, plan(), [{ ...milestones()[0], id: foreign }])).rejects.toThrow("another project");
    expect((await get()).payments).toHaveLength(1);
    expect((await get(admin, otherProject)).payments).toHaveLength(0);
  });

  it("bounds refunds by their original allocated and unallocated amounts and preserves an immutable ledger", async () => {
    await save();
    await record(admin, payment(paymentOne, { amount_minor: 500_000 }), [allocation(300_000)]);
    const refund = payment(paymentTwo, { kind: "refund", purpose: "other", amount_minor: 250_000, paid_on: "2020-01-02", related_payment_id: paymentOne });
    await expect(record(admin, refund)).rejects.toThrow("unallocated credit");
    const refunded = await record(admin, refund, [allocation(100_000)]);
    expect(refunded.summary).toMatchObject({ received_minor: 500_000, refunded_minor: 250_000, net_received_minor: 250_000, unallocated_minor: 50_000, outstanding_minor: 750_000 });
    expect(refunded.milestones[0]?.paid_minor).toBe(200_000);
    await expect(record(admin, payment(paymentThree, { ...refund, id: paymentThree, amount_minor: 250_001 }), [allocation(200_000)])).rejects.toThrow("Refunds require");
    await expect(record(admin, payment(paymentThree, { ...refund, id: paymentThree, amount_minor: 200_001 }), [allocation(200_001)])).rejects.toThrow();
    await expect(record(admin, payment(paymentThree, { ...refund, id: paymentThree, amount_minor: 50_001 }))).rejects.toThrow("unallocated credit");
    await expect(record(admin, payment(paymentThree, { ...refund, id: paymentThree, paid_on: "2019-12-31", amount_minor: 1 }))).rejects.toThrow("valid refund date");
    await expect(review(paymentOne, "void", "Correct source")).rejects.toThrow("linked refunds");
    await expect(allocate(paymentOne, [])).rejects.toThrow("linked refunds");
    await expect(asActor(admin, "update public.project_payments set amount_minor=1 where id=$1", [paymentOne])).rejects.toThrow();
    await expect(asActor(admin, "delete from public.project_payments where id=$1", [paymentTwo])).rejects.toThrow();
    await review(paymentTwo, "void", "Refund entry corrected");
    expect((await review(paymentOne, "void", "Receipt entry corrected")).summary?.net_received_minor).toBe(0);
  });

  it("enforces actual nonfuture dates, finite safe integer bounds, and receipts may exceed the quote as visible credit", async () => {
    await save(admin, 0, plan({ total_minor: 100 }), []);
    for (const value of [0, -1, 0.5, 1_000_000_000_001, "100"]) await expect(record(admin, payment(paymentOne, { amount_minor: value }))).rejects.toThrow();
    for (const paid_on of ["9999-12-31", "infinity", "2020-02-30"]) await expect(record(admin, payment(paymentOne, { paid_on }))).rejects.toThrow();
    const received = await record(admin, payment(paymentOne, { amount_minor: 1_000_000_000_000 }));
    expect(received.summary).toMatchObject({ outstanding_minor: 0, credit_minor: 999_999_999_900 });
    await expect(record(admin, payment(paymentTwo, { amount_minor: 1 }))).rejects.toThrow("supported amount range");
    expect((await get()).payments).toHaveLength(1);
  });

  it("uses only explicit payment flags or dates for due amounts rather than work-stage changes", async () => {
    await save(admin, 0, plan(), [{ ...milestones()[0], is_due: false, due_date: "2020-01-01" }, milestones()[1]]);
    expect((await get()).summary?.due_now_minor).toBe(600_000);
    await asActor(partner, "update public.tasks set status='done' where id=$1", [task]);
    expect((await get()).summary?.due_now_minor).toBe(600_000);
    await save(admin, 1, plan(), milestones().map((row) => ({ ...row, is_due: false })));
    expect((await get()).summary?.due_now_minor).toBe(0);
  });

  it("shares only an explicitly enabled summary with partners and records finance privately outside work activity", async () => {
    const before = firstRow(await db.query<{ count: string }>("select count(*)::text as count from public.project_activity where project_id=$1", [project])).count;
    await save();
    await record();
    expect((await get(partner)).configured).toBe(false);
    await save(admin, 1, plan({ partner_summary_visible: true }));
    const shared = await get(partner);
    expect(shared).toMatchObject({ access: "partner", configured: true, payments: [], allocations: [], audit: [] });
    expect(shared.plan).not.toHaveProperty("scope_notes");
    expect(shared.plan).not.toHaveProperty("payment_instructions");
    expect(shared.plan).not.toHaveProperty("created_by");
    expect(JSON.stringify(shared)).not.toContain("PRIVATE-REFERENCE");
    for (const table of ["project_finance", "project_payment_milestones", "project_payments", "project_payment_allocations", "project_finance_audit"]) {
      const column = table === "project_finance" ? "project_id" : table === "project_payment_allocations" ? "payment_id" : "id";
      expect((await asActor(partner, `select ${column} from public.${table}`)).rows).toEqual([]);
    }
    await expect(asActor(client, "select request_payload from public.project_payments")).rejects.toThrow();
    expect((await get()).audit.every((row) => row.actor_id === admin && Date.parse(row.created_at) > Date.parse("2020-01-01"))).toBe(true);
    expect((await asActor(client, "select id from public.project_finance_audit")).rows).toEqual([]);
    await save(admin, 2, plan({ partner_summary_visible: false }));
    expect((await get(partner)).configured).toBe(false);
    const after = firstRow(await db.query<{ count: string }>("select count(*)::text as count from public.project_activity where project_id=$1", [project])).count;
    expect(after).toBe(before);
  });

  it("uses a private proof bucket with owner uploads and denies partner/outsider file access", async () => {
    await save();
    const path = `${project}/${client}/${paymentOne}-receipt.pdf`;
    await upload(client, path);
    for (const actor of [admin, client, otherClient]) expect((await asActor(actor, "select name from storage.objects where bucket_id='project-finance'")).rows).toEqual([{ name: path }]);
    for (const actor of [partner, outsider]) {
      expect((await asActor(actor, "select name from storage.objects where bucket_id='project-finance'")).rows).toEqual([]);
      await expect(upload(actor)).rejects.toThrow();
    }
    await expect(upload(client, `${project}/${admin}/${paymentTwo}-forged.pdf`)).rejects.toThrow();
    await expect(upload(client, `${otherProject}/${client}/${paymentTwo}-other.pdf`)).rejects.toThrow();
    await expect(upload(client, `${project}/${client}/${paymentTwo}-unsafe.svg`)).rejects.toThrow();
    await expect(asActor(null, "select name from storage.objects where bucket_id='project-finance'")).rejects.toThrow();
    await expect(record(otherClient, payment(paymentOne, { proof_path: path }))).rejects.toThrow("this project");
    const attached = await record(admin, payment(paymentOne, { proof_path: path }));
    expect(attached.payments[0]?.proof_path).toBe(path);
    await save(admin, 1, plan({ partner_summary_visible: true }));
    expect((await asActor(partner, "select name from storage.objects where bucket_id='project-finance'")).rows).toEqual([]);
  });

  it("retains linked proof evidence through voids, blocks operator deletion/overwrite, and allows unused own-upload cleanup", async () => {
    await save();
    const linked = `${project}/${client}/${paymentOne}-receipt.pdf`;
    const unused = `${project}/${client}/${paymentTwo}-unused.pdf`;
    await upload(client, linked);
    await upload(client, unused);
    await record(client, payment(paymentOne, { proof_path: linked }));
    expect((await asActor(client, "delete from storage.objects where bucket_id='project-finance' and name=$1 returning name", [linked])).rows).toEqual([]);
    expect((await asActor(otherClient, "delete from storage.objects where bucket_id='project-finance' and name=$1 returning name", [unused])).rows).toEqual([]);
    expect((await asActor(client, "delete from storage.objects where bucket_id='project-finance' and name=$1 returning name", [unused])).rows).toEqual([{ name: unused }]);
    await expect(operator("delete from storage.objects where bucket_id='project-finance' and name=$1", [linked])).rejects.toThrow("retained");
    await expect(operator("update storage.objects set name=$2 where bucket_id='project-finance' and name=$1", [linked, unused])).rejects.toThrow("retained");
    await expect(operator("update storage.objects set metadata='{}' where bucket_id='project-finance' and name=$1", [linked])).rejects.toThrow("retained");
    await review(paymentOne, "void", "Invalid receipt report");
    await expect(operator("delete from storage.objects where bucket_id='project-finance' and name=$1", [linked])).rejects.toThrow("retained");
  });

  it("rejects missing, oversized or mismatched proof metadata when attaching a payment", async () => {
    await save();
    const path = `${project}/${client}/${paymentOne}-receipt.pdf`;
    await expect(record(client, payment(paymentOne, { proof_path: path }))).rejects.toThrow("Finish uploading");
    await upload(client, path, { size: 5_242_881, mimetype: "application/pdf" });
    await expect(record(client, payment(paymentOne, { proof_path: path }))).rejects.toThrow("Finish uploading");
    await operator("update storage.objects set metadata=$2::jsonb where name=$1", [path, JSON.stringify({ size: 100 })]);
    await expect(record(client, payment(paymentOne, { proof_path: path }))).rejects.toThrow("Finish uploading");
    await operator("update storage.objects set metadata=$2::jsonb where name=$1", [path, JSON.stringify({ size: 100, mimetype: "image/png" })]);
    await expect(record(client, payment(paymentOne, { proof_path: path }))).rejects.toThrow("Finish uploading");
    expect((await get()).payments).toEqual([]);
  });
});
