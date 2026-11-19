// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
    create table storage.buckets (id text primary key, name text, public boolean not null default false, file_size_limit bigint);
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
