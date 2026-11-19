// Run only after restoring the source and applying portal_workflows. Never logs API bodies or credentials.
import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openTarget, workspace } from "./connection.mjs";

const ref = "cwhofudilhawuvmhzgdx", run = randomUUID();
const ledger = { target: ref, run, users: [], projects: [], objects: [], tasks: [], documents: [], cleanup_complete: false };
const directory = join(workspace, ".migration-private"), ledgerPath = join(directory, `workflow-check-${run}.json`);
const tables = ["auth.users", "auth.identities", "public.profiles", "public.user_roles", "public.projects", "public.project_members", "public.tasks", "public.comments", "public.documents", "public.task_approvals", "public.task_approval_plan", "public.project_imports", "storage.objects"];
let sql, apiConfig, targetApi, baseline, phase = "configuration", passed = 0, failed = false;
const ensure = (condition) => { if (!condition) throw new Error("Workflow assertion failed"); };
const save = () => { mkdirSync(directory, { recursive: true }); writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), { mode: 0o600 }); };
const denied = (result) => (result.status >= 400 && result.status < 500) || (result.ok && Array.isArray(result.data) && result.data.length === 0);
const one = (data) => { if (Array.isArray(data)) { ensure(data.length === 1); return data[0]; } ensure(data && typeof data === "object"); return data; };
const options = (token, method, body) => ({ token, method, body, headers: { Prefer: "return=representation" } });
const encoded = (path) => path.split("/").map(encodeURIComponent).join("/");
async function api(path, settings) { const result = await targetApi(path, settings); ensure(result.ok); return result.data; }
async function check(label, action) { phase = label; await action(); passed++; console.log(JSON.stringify({ check: label, ok: true })); }
async function state() {
  const counts = (await sql`select (select count(*)::int from auth.users) users, (select count(*)::int from public.user_roles where role='admin') admins, (select count(*)::int from public.projects) projects, (select count(*)::int from public.tasks) tasks`)[0];
  const hashes = {};
  for (const table of tables) hashes[table] = (await sql.unsafe(`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text) hash from ${table} t`))[0].hash;
  return { counts, hashes };
}
async function upload(path, token) {
  const response = await fetch(`${apiConfig.apiUrl}/storage/v1/object/project-files/${encoded(path)}`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000), headers: { apikey: apiConfig.publishableKey, Authorization: `Bearer ${token}`, "Content-Type": "text/plain", "x-upsert": "false" }, body: "Temporary workflow evidence" });
  await response.arrayBuffer(); ensure(response.ok);
}
async function signed(path, token) { return targetApi(`/storage/v1/object/sign/project-files/${encoded(path)}`, { token, method: "POST", body: { expiresIn: 60 } }); }
async function readSigned(result) {
  const value = result.data?.signedURL ?? result.data?.signedUrl; ensure(result.ok && typeof value === "string");
  const url = new URL(value.startsWith("/storage/v1/") ? value : `/storage/v1${value}`, apiConfig.apiUrl); ensure(url.origin === apiConfig.apiUrl);
  const read = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) }); ensure(read.ok && await read.text() === "Temporary workflow evidence");
}
async function cleanup() {
  const errors = [];
  const attempt = async (label, action) => { try { await action(); } catch { errors.push(label); } };
  for (const id of ledger.projects) await attempt("approval/document cleanup", async () => { await sql`delete from public.task_approvals where project_id=${id}`; await sql`delete from public.documents where project_id=${id}`; });
  for (const path of ledger.objects) await attempt("storage blob cleanup", async () => {
    ensure((await targetApi("/storage/v1/object/project-files", { privileged: true, method: "DELETE", body: { prefixes: [path] } })).ok);
    ensure((await sql`select count(*)::int n from storage.objects where bucket_id='project-files' and name=${path}`)[0].n === 0);
  });
  for (const id of ledger.projects) await attempt("project cleanup", async () => { await sql`delete from public.projects where id=${id}`; });
  for (const id of ledger.users) await attempt("temporary identity cleanup", async () => {
    const result = await targetApi(`/auth/v1/admin/users/${id}`, { privileged: true, method: "DELETE" });
    ensure(result.ok || result.status === 404); ensure((await sql`select count(*)::int n from auth.users where id=${id}`)[0].n === 0);
  });
  return errors;
}

try {
  ({ apiConfig, targetApi } = await import("./api.mjs"));
  ensure(apiConfig.projectRef === ref && apiConfig.apiUrl === `https://${ref}.supabase.co`);
  ({ sql } = openTarget());
  await check("Restored baseline", async () => { baseline = await state(); ensure(JSON.stringify(baseline.counts) === JSON.stringify({ users: 1, admins: 1, projects: 1, tasks: 20 })); });
  const users = {};
  await check("Temporary authenticated roles", async () => {
    for (const role of ["admin", "partner", "client"]) {
      const id = randomUUID(), email = `workflow-${run}-${role}@example.test`, password = randomBytes(36).toString("base64url");
      ledger.users.push(id); save();
      const created = one(await api("/auth/v1/admin/users", { privileged: true, method: "POST", body: { id, email, password, email_confirm: true, user_metadata: { full_name: `Temporary ${role}` } } }));
      ensure(created.id === id || created.user?.id === id);
      await sql`delete from public.user_roles where user_id=${id}`; await sql`insert into public.user_roles(user_id,role) values (${id},${role})`;
      const login = await api("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
      ensure(typeof login.access_token === "string" && login.user?.id === id); users[role] = { id, token: login.access_token };
    }
  });
  const { admin, partner, client } = users;
  const a = randomUUID(), b = randomUUID(), taskA = randomUUID(), taskB = randomUUID(), doc = randomUUID();
  ledger.projects.push(a, b); ledger.tasks.push(taskA, taskB); ledger.documents.push(doc); ledger.objects.push(`${a}/${randomUUID()}.txt`, `${b}/${randomUUID()}.txt`); save();
  const [fileA, fileB] = ledger.objects;
  await check("Admin project creation and memberships", async () => {
    for (const id of [a, b]) one(await api("/rest/v1/projects", options(admin.token, "POST", { id, name: `Temporary workflow ${id === a ? "A" : "B"}`, created_by: admin.id })));
    const members = await api("/rest/v1/project_members", options(admin.token, "POST", [{ project_id: a, user_id: partner.id, access: "partner" }, { project_id: a, user_id: client.id, access: "client" }])); ensure(members.length === 2);
    one(await api("/rest/v1/tasks", options(partner.token, "POST", { id: taskA, project_id: a, title: "Temporary layout", created_by: client.id })));
    one(await api("/rest/v1/tasks", options(admin.token, "POST", { id: taskB, project_id: b, title: "Private second project" })));
  });
  await check("Project isolation for partners and clients", async () => {
    for (const user of [partner, client]) {
      ensure((await api(`/rest/v1/projects?id=eq.${a}&select=id`, { token: user.token })).length === 1);
      ensure((await api(`/rest/v1/projects?id=eq.${b}&select=id`, { token: user.token })).length === 0);
      ensure((await api(`/rest/v1/tasks?id=eq.${taskB}&select=id`, { token: user.token })).length === 0);
      ensure(denied(await targetApi(`/rest/v1/tasks?id=eq.${taskB}`, options(user.token, "PATCH", { status: "done" }))));
      ensure(denied(await targetApi(`/rest/v1/projects?id=eq.${b}`, options(user.token, "PATCH", { name: "Unauthorized" }))));
    }
  });
  await check("Client task and project writes denied", async () => {
    ensure(denied(await targetApi(`/rest/v1/tasks?id=eq.${taskA}`, options(client.token, "PATCH", { status: "done" }))));
    ensure(denied(await targetApi(`/rest/v1/projects?id=eq.${a}`, options(client.token, "PATCH", { name: "Unauthorized" }))));
    const original = (await sql`select status,created_by from public.tasks where id=${taskA}`)[0]; ensure(original.status === "not_started" && original.created_by === partner.id);
  });
  await check("Client comments and explicit relationship embeds", async () => {
    const comment = one(await api("/rest/v1/comments", options(client.token, "POST", { project_id: a, task_id: taskA, user_id: client.id, body: "Temporary client feedback" })));
    const embedded = one(await api(`/rest/v1/comments?id=eq.${comment.id}&select=id,author:profiles!comments_user_id_fkey(full_name),task:tasks!comments_task_project_fkey(id,title)`, { token: client.token }));
    ensure(embedded.author?.full_name === "Temporary client" && embedded.task?.id === taskA);
  });
  await check("Forged and cross-project comments denied", async () => {
    for (const body of [{ project_id: a, task_id: taskA, user_id: partner.id, body: "Forged" }, { project_id: b, task_id: taskB, user_id: client.id, body: "Outsider" }, { project_id: a, task_id: taskB, user_id: client.id, body: "Wrong task" }]) ensure(denied(await targetApi("/rest/v1/comments", options(client.token, "POST", body))));
  });
  await check("Private uploads and database attribution", async () => {
    await upload(fileA, partner.token); await upload(fileB, admin.token);
    const saved = one(await api("/rest/v1/documents", options(partner.token, "POST", { id: doc, project_id: a, task_id: taskA, name: "Temporary evidence.txt", path: fileA, size: 27, uploaded_by: client.id, created_at: "2000-01-01T00:00:00Z" })));
    ensure(saved.uploaded_by === partner.id && new Date(saved.created_at).getUTCFullYear() >= 2026);
  });
  await check("Private signed read and foreign-file denial", async () => {
    const allowed = await signed(fileA, client.token), existing = await signed(fileB, admin.token), blocked = await signed(fileB, client.token);
    ensure(allowed.ok && existing.ok && !blocked.ok && blocked.status >= 400 && blocked.status < 500);
    await readSigned(allowed);
  });
  let approval;
  await check("Editor requests immutable client review", async () => {
    approval = one(await api("/rest/v1/rpc/request_task_approval", { token: partner.token, method: "POST", body: { p_task_id: taskA } }));
    ensure(approval.state === "pending" && approval.requested_by === partner.id && approval.snapshot.documents[0]?.id === doc);
  });
  await check("Decision authorization and feedback requirements", async () => {
    const request = { p_approval_id: approval.id, p_decision: "approved", p_feedback: null };
    ensure(denied(await targetApi("/rest/v1/rpc/respond_task_approval", { token: partner.token, method: "POST", body: request })));
    ensure(denied(await targetApi("/rest/v1/rpc/respond_task_approval", { token: client.token, method: "POST", body: { ...request, p_decision: "changes_requested", p_feedback: " \t\n" } })));
    ensure(denied(await targetApi(`/rest/v1/task_approvals?id=eq.${approval.id}`, options(client.token, "PATCH", { state: "approved", decided_by: client.id }))));
    const decided = one(await api("/rest/v1/rpc/respond_task_approval", { token: client.token, method: "POST", body: request })); ensure(decided.state === "approved" && decided.decided_by === client.id && decided.decided_at);
  });
  await check("Submitted evidence survives deletion attempts", async () => {
    ensure(denied(await targetApi(`/rest/v1/documents?id=eq.${doc}`, options(partner.token, "DELETE"))));
    const removed = await targetApi("/storage/v1/object/project-files", { token: partner.token, method: "DELETE", body: { prefixes: [fileA] } }); ensure(denied(removed));
    ensure((await sql`select count(*)::int n from public.documents where id=${doc}`)[0].n === 1); await readSigned(await signed(fileA, client.token));
  });
  await check("Content revisions reject stale decisions", async () => {
    const revised = one(await api(`/rest/v1/tasks?id=eq.${taskA}`, options(partner.token, "PATCH", { title: "Revised temporary layout" }))); ensure(revised.content_revision === approval.revision + 1);
    const pending = one(await api("/rest/v1/rpc/request_task_approval", { token: partner.token, method: "POST", body: { p_task_id: taskA } }));
    one(await api(`/rest/v1/tasks?id=eq.${taskA}`, options(partner.token, "PATCH", { description: "A later revision" })));
    const stale = await targetApi("/rest/v1/rpc/respond_task_approval", { token: client.token, method: "POST", body: { p_approval_id: pending.id, p_decision: "approved" } });
    // PostgreSQL 55000 is the intentional stale-state rejection; PostgREST maps it to HTTP 500.
    ensure(!stale.ok && stale.data?.code === "55000");
  });
  await check("Prior decisions and submitted content retained", async () => {
    const history = await api(`/rest/v1/task_approvals?task_id=eq.${taskA}&select=id,state,snapshot`, { token: client.token });
    ensure(history.length === 2 && history.some((row) => row.id === approval.id && row.state === "approved" && row.snapshot.task.title === "Temporary layout"));
    ensure((await sql`select status from public.tasks where id=${taskA}`)[0].status === "not_started");
  });
} catch {
  failed = true; console.error(JSON.stringify({ result: "failed", check: phase, message: "Workflow check failed; API bodies and credentials were not logged." }));
} finally {
  if (sql) {
    const errors = await cleanup().catch(() => ["cleanup unavailable"]);
    if (errors.length) { failed = true; console.error(JSON.stringify({ cleanup: "incomplete", steps: errors })); }
    try {
      const final = await state(); ensure(baseline && JSON.stringify(final) === JSON.stringify(baseline));
      ensure(final.counts.users === 1 && final.counts.projects === 1 && final.counts.tasks === 20);
      ledger.cleanup_complete = errors.length === 0; console.log(JSON.stringify({ check: "Original records unchanged after cleanup", ok: true, counts: final.counts }));
    } catch { failed = true; console.error(JSON.stringify({ cleanup: "verification failed", message: "Inspect the private cleanup ledger before continuing." })); }
    try { await sql.end({ timeout: 3 }); } catch { failed = true; }
  }
  try { save(); } catch { failed = true; console.error(JSON.stringify({ cleanup: "ledger save failed" })); }
  console.log(JSON.stringify({ result: failed ? "failed" : "passed", checks: passed, cleanup_complete: ledger.cleanup_complete }));
  if (failed) process.exitCode = 1;
}
