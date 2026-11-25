// Only selected by Vite's explicit, serve-only client-preview mode. Never a production auth fallback.
import { createClient, type User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createPreviewFixtures, previewIds } from "./fixtures";
import { createPreviewFinanceSession, PreviewFinanceError } from "./finance";
import { localPreviewRole } from "./role";
import { STAGES, STATUSES, PRIORITIES } from "@/lib/constants";

export { previewIds } from "./fixtures";
export const previewRole = localPreviewRole();
const fixture = createPreviewFixtures(previewRole);
const financeProofs = new Map<string, Blob>();
const actorId = previewRole === "admin" ? previewIds.admin : previewIds.client;
const finance = createPreviewFinanceSession(previewRole, actorId, (path) => financeProofs.has(path));
export function localFinanceProof(projectId: string, path: string): Blob {
  const proof = financeProofs.get(path);
  if (projectId !== previewIds.project || !path.startsWith(`${projectId}/`) || !proof) throw new Error("Sample payment proof not found.");
  return proof;
}
const base = typeof window === "undefined" ? "http://127.0.0.1:4173" : window.location.origin;
const storageKey = `spacenez-local-${previewRole}-preview`;
export const previewUser: User = {
  id: actorId, aud: "authenticated", role: "authenticated", email: previewRole === "admin" ? "admin@example.test" : "client@example.test",
  app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: previewRole === "admin" ? "Sample Admin" : "Sample Client" },
  created_at: new Date().toISOString(), email_confirmed_at: new Date().toISOString(),
};
function encode(value: unknown) { return btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); }
function session() {
  const expiresAt = Math.floor(Date.now() / 1000) + 86400;
  return { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: previewUser.id, role: "authenticated", aud: "authenticated", email: previewUser.email, exp: expiresAt, iat: expiresAt - 86400 })}.${encode("local-preview-only")}`, refresh_token: "local-preview-refresh", expires_at: expiresAt, expires_in: 86400, token_type: "bearer", user: previewUser };
}
const memory = new Map<string, string>([[storageKey, JSON.stringify(session())]]);
function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });
}
function denied(message = "This action is unavailable in the local client preview.") { return json({ code: "PREVIEW_ONLY", message, error: message }, 403); }

type PreviewRow = Record<string, unknown>;
type PreviewTask = Database["public"]["Tables"]["tasks"]["Row"];
const taskFields = ["title", "description", "status", "stage", "priority", "assignee_id", "start_date", "due_date", "position"] as const;
function validTask(task: PreviewTask) {
  const date = (value: unknown) => value === null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
  return typeof task.title === "string" && !!task.title.trim() && (task.description === null || typeof task.description === "string")
    && STAGES.some((stage) => stage.key === task.stage) && STATUSES.some((status) => status.key === task.status) && PRIORITIES.some((priority) => priority.key === task.priority)
    && (task.assignee_id === null || fixture.profiles.some((profile) => profile.id === task.assignee_id))
    && date(task.start_date) && date(task.due_date) && Number.isSafeInteger(task.position) && task.position >= 0;
}
function taskActivity(task: PreviewTask, previous?: PreviewTask) {
  const changes = previous ? Object.fromEntries(taskFields.filter((field) => previous[field] !== task[field]).map((field) => [field, { from: previous[field], to: task[field] }])) : {};
  if (previous && !Object.keys(changes).length) return;
  fixture.project_activity.push({ id: crypto.randomUUID(), project_id: previewIds.project, actor_id: actorId, kind: previous ? "task_updated" : "task_created", occurred_at: task.updated_at, source_type: "tasks", source_id: task.id, task_id: task.id, payload: { title: task.title, status: task.status, stage: task.stage, changes } });
}
function mutationResponse(request: Request, rows: PreviewRow[], status = 200) {
  if (!request.headers.get("prefer")?.includes("return=representation")) return json(null, status === 201 ? 201 : 204);
  return request.headers.get("accept")?.includes("application/vnd.pgrst.object+json")
    ? rows.length === 1 ? json(rows[0], status) : json({ code: "PGRST116", message: "No matching sample record." }, 406)
    : json(rows, status);
}
function rowsFor(table: string): PreviewRow[] | null {
  if (!(table in fixture)) return null;
  const rows = fixture[table as keyof typeof fixture] as unknown as PreviewRow[];
  if (table === "project_members") return rows.map((row) => ({ ...row, profile: fixture.profiles.find((profile) => profile.id === row["user_id"]) ?? null }));
  if (table === "comments") return rows.map((row) => ({ ...row, author: fixture.profiles.find((profile) => profile.id === row["user_id"]) ?? null, task: fixture.tasks.find((task) => task.id === row["task_id"]) ?? null }));
  if (table === "project_daily_updates") return rows.map((row) => ({ ...row, author: fixture.profiles.find((profile) => profile.id === row["created_by"]) ?? null }));
  if (table === "project_activity") return rows.map((row) => ({ ...row, author: fixture.profiles.find((profile) => profile.id === row["actor_id"]) ?? null }));
  return rows;
}

/** A closed in-memory transport: no fallback to global fetch or any live backend. */
export const previewFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== base) return denied("The local preview cannot contact an external backend.");
  const path = url.pathname;
  const financeUpload = request.method === "POST" && path.startsWith("/storage/v1/object/project-finance/");
  const body = request.method === "GET" || request.method === "HEAD" || financeUpload ? {} : await request.json().catch(() => ({})) as Record<string, unknown>;
  if (path.startsWith("/auth/v1/")) {
    if (path === "/auth/v1/user" && request.method === "GET") return json(previewUser);
    if (path === "/auth/v1/token" && request.method === "POST") {
      if (url.searchParams.get("grant_type") !== "refresh_token" && (body["email"] !== previewUser.email || body["password"] !== `preview-${previewRole}`)) return json({ msg: `Use ${previewUser.email} and preview-${previewRole} for this local preview.` }, 400);
      return json(session());
    }
    if (path === "/auth/v1/logout") return json(null, 204);
    return denied("Email and password changes are disabled in the local preview. Reload to reset the sample session.");
  }
  if (path.startsWith("/storage/v1/object/sign/project-files") && request.method === "POST") {
    const signed = (filePath: string) => `/object/sign/project-files/${filePath}?token=local-preview`;
    const allowed = (filePath: string) => fixture.documents.some((document) => document.path === filePath);
    if (Array.isArray(body["paths"])) {
      return json(body["paths"].map((filePath: unknown) => typeof filePath === "string" && allowed(filePath) ? { path: filePath, signedURL: signed(filePath), error: null } : { path: filePath, signedURL: null, error: "Sample file not found" }));
    }
    const filePath = decodeURIComponent(path.slice("/storage/v1/object/sign/project-files/".length));
    return allowed(filePath) ? json({ signedURL: signed(filePath) }) : denied("Sample file not found.");
  }
  if (financeUpload) {
    const filePath = decodeURIComponent(path.slice("/storage/v1/object/project-finance/".length));
    if (!finance.read().configured || !filePath.startsWith(`${previewIds.project}/${actorId}/`) || filePath.split("/").length !== 3) return denied();
    const uploaded = request.headers.get("content-type")?.startsWith("multipart/")
      ? Array.from((await request.formData()).values()).find((value): value is File => typeof value !== "string")
      : await request.blob();
    if (!uploaded || uploaded.size === 0 || uploaded.size > 5 * 1024 * 1024 || !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(uploaded.type)) return denied("Use a PDF, PNG, JPEG or WebP up to 5 MB.");
    financeProofs.set(filePath, uploaded);
    return json({ Key: `project-finance/${filePath}`, Id: crypto.randomUUID() });
  }
  if (path === "/storage/v1/object/project-finance" && request.method === "DELETE") {
    const paths = body["prefixes"];
    if (!Array.isArray(paths) || paths.some((value) => typeof value !== "string" || !financeProofs.has(value) || finance.read().payments.some((payment) => payment.proof_path === value))) return denied();
    for (const value of paths) financeProofs.delete(String(value));
    return json([]);
  }
  if (path.startsWith("/storage/v1/object/sign/project-finance/")) {
    const filePath = decodeURIComponent(path.slice("/storage/v1/object/sign/project-finance/".length));
    const file = financeProofs.get(filePath);
    if (!file) return denied("Sample payment proof not found.");
    if (request.method === "POST") return json({ signedURL: `/object/sign/project-finance/${filePath}?token=local-preview` });
    if (request.method === "GET" && url.searchParams.get("token") === "local-preview") return new Response(file, { headers: { "Content-Type": file.type } });
    return denied();
  }
  if (path.startsWith("/rest/v1/rpc/")) {
    const rpc = path.slice("/rest/v1/rpc/".length);
    if (rpc === "get_project_task_people" && request.method === "POST") {
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "p_project_id") || body["p_project_id"] !== previewIds.project || !fixture.projects.some((project) => project.id === body["p_project_id"])) return denied("Choose the sample project to load its task owners.");
      const isAdmin = fixture.user_roles.some((role) => role.user_id === actorId && role.role === "admin");
      const membership = fixture.project_members.find((member) => member.project_id === previewIds.project && member.user_id === actorId);
      if (!fixture.profiles.some((profile) => profile.id === actorId) || (!isAdmin && !membership)) return denied("You do not have access to this sample project.");
      const canEdit = isAdmin || membership?.access === "partner";
      const eligible = new Set<string>([
        ...fixture.project_members.filter((member) => member.project_id === previewIds.project).map((member) => member.user_id),
        ...fixture.tasks.filter((task) => task.project_id === previewIds.project && task.assignee_id).map((task) => task.assignee_id!),
        ...(canEdit ? fixture.user_roles.filter((role) => role.role === "admin").map((role) => role.user_id) : []),
      ]);
      const people = fixture.profiles.filter((profile) => eligible.has(profile.id)).map((profile) => ({
        id: profile.id,
        full_name: profile.full_name?.trim() || profile.email?.split("@")[0]?.trim() || "Team member",
        email: canEdit ? profile.email : null,
      })).sort((left, right) => left.full_name.localeCompare(right.full_name, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id));
      return json(people);
    }
    if (["get_project_finance", "save_project_finance", "record_project_payment", "review_project_payment", "allocate_project_payment"].includes(rpc) && request.method === "POST") {
      if (["get_project_finance", "save_project_finance", "record_project_payment"].includes(rpc) && body["p_project_id"] !== previewIds.project) return denied();
      try {
        if (rpc === "get_project_finance") return json(finance.read());
        if (rpc === "save_project_finance") return json(finance.save(body["p_expected_version"], body["p_plan"], body["p_milestones"]));
        if (rpc === "record_project_payment") return json(finance.record(body["p_payment"], body["p_allocations"]));
        if (rpc === "review_project_payment") return json(finance.review(body["p_payment_id"], body["p_decision"], body["p_reason"], body["p_allocations"]));
        return json(finance.allocate(body["p_payment_id"], body["p_allocations"]));
      } catch (error) {
        const code = error instanceof PreviewFinanceError ? error.code : "22023";
        const message = error instanceof Error ? error.message : "Invalid sample payment details.";
        return json({ code, message, error: message }, code === "42501" ? 403 : ["23505", "40001"].includes(code) ? 409 : 400);
      }
    }
    if (rpc === "respond_task_approval" && request.method === "POST") {
      const approval = fixture.task_approvals.find((entry) => entry.id === body["p_approval_id"]);
      const decision = body["p_decision"];
      const feedback = typeof body["p_feedback"] === "string" ? body["p_feedback"].trim() : null;
      if (!approval || approval.state !== "pending" || !["approved", "changes_requested"].includes(String(decision))) return denied("This sample approval is no longer available. Reload to reset it.");
      if (decision === "changes_requested" && !feedback) return denied("Describe the changes needed before submitting.");
      approval.state = decision as "approved" | "changes_requested"; approval.decided_by = previewIds.client; approval.decided_at = new Date().toISOString(); approval.feedback = feedback;
      return json(approval);
    }
    if (rpc === "has_role") return json(body["_role"] === previewRole && (body["_user_id"] == null || body["_user_id"] === actorId));
    return denied();
  }
  if (!path.startsWith("/rest/v1/")) return denied("Unknown local preview endpoint.");
  const table = path.slice("/rest/v1/".length);
  if (table === "tasks" && (request.method === "POST" || request.method === "PATCH")) {
    if (previewRole !== "admin" || !body || typeof body !== "object" || Array.isArray(body)) return denied("Only the local admin can edit sample tasks.");
    const allowed = request.method === "POST" ? [...taskFields, "project_id", "created_by"] : taskFields;
    if (Object.keys(body).some((field) => !allowed.some((allowedField) => allowedField === field))) return denied("Only editable sample task fields can be changed.");
    if (request.method === "POST") {
      if (body["project_id"] !== previewIds.project || body["created_by"] !== actorId) return denied("The sample task must belong to this project and admin.");
      const now = new Date().toISOString();
      const task: PreviewTask = {
        id: crypto.randomUUID(), project_id: previewIds.project, created_by: actorId, title: "", description: null, stage: "planning", status: "not_started", priority: "medium", assignee_id: null, start_date: null, due_date: null,
        position: Math.max(-1, ...fixture.tasks.map((entry) => entry.position)) + 1, created_at: now, updated_at: now, content_revision: 1, source_id: null, source_metadata: {},
        ...body,
      };
      if (!validTask(task)) return denied("Enter a valid sample task title, stage, owner and dates.");
      task.title = task.title.trim();
      fixture.tasks.push(task);
      taskActivity(task);
      return mutationResponse(request, [task], 201);
    }
    if (url.searchParams.get("project_id") !== `eq.${previewIds.project}` || !url.searchParams.get("id")?.startsWith("eq.") || Array.from(url.searchParams.keys()).some((key) => !["id", "project_id", "select"].includes(key))) return denied("Choose one task in the sample project before updating it.");
    const task = fixture.tasks.find((entry) => `eq.${entry.id}` === url.searchParams.get("id"));
    if (!task) return mutationResponse(request, []);
    const previous = { ...task };
    const next = { ...task, ...body };
    if (!validTask(next)) return denied("Enter a valid sample task title, stage, owner and dates.");
    next.title = next.title.trim();
    if (taskFields.some((field) => previous[field] !== next[field])) {
      next.updated_at = new Date().toISOString();
      if (["title", "description", "stage"].some((field) => previous[field as keyof PreviewTask] !== next[field as keyof PreviewTask])) next.content_revision += 1;
      Object.assign(task, next);
      taskActivity(task, previous);
    }
    return mutationResponse(request, [task]);
  }
  if (request.method === "POST" && table === "comments") {
    const taskId = body["task_id"];
    if (body["project_id"] !== previewIds.project || body["user_id"] !== actorId || typeof body["body"] !== "string" || !body["body"].trim() || (taskId !== null && !fixture.tasks.some((task) => task.id === taskId))) return denied("The sample comment is invalid.");
    const comment = { id: crypto.randomUUID(), project_id: previewIds.project, task_id: typeof taskId === "string" ? taskId : null, user_id: actorId, body: body["body"].trim(), created_at: new Date().toISOString() };
    fixture.comments.push(comment);
    fixture.project_activity.push({ id: crypto.randomUUID(), project_id: previewIds.project, actor_id: actorId, kind: "comment_added", occurred_at: comment.created_at, source_type: "comments", source_id: comment.id, task_id: comment.task_id, payload: { body: comment.body, task_title: fixture.tasks.find((task) => task.id === comment.task_id)?.title ?? null } });
    return json(null, 201);
  }
  if (request.method !== "GET" && request.method !== "HEAD") return denied();
  let rows = rowsFor(table);
  if (!rows) return denied("Unknown local preview table.");
  for (const [key, filter] of url.searchParams) {
    if (["select", "order", "offset", "limit"].includes(key)) continue;
    if (filter.startsWith("eq.")) rows = rows.filter((row) => String(row[key]) === filter.slice(3));
    else if (filter.startsWith("gte.")) rows = rows.filter((row) => String(row[key]) >= filter.slice(4));
    else if (filter.startsWith("lte.")) rows = rows.filter((row) => String(row[key]) <= filter.slice(4));
    else if (filter.startsWith("lt.")) rows = rows.filter((row) => String(row[key]) < filter.slice(3));
    else if (filter === "is.null") rows = rows.filter((row) => row[key] === null);
    else return denied("Unsupported local preview filter.");
  }
  const order = url.searchParams.get("order")?.split(",") ?? [];
  rows = [...rows].sort((left, right) => {
    for (const part of order) {
      const [key, direction] = part.split(".");
      if (!key) continue;
      const a = left[key]; const b = right[key];
      const comparison = typeof a === "number" && typeof b === "number" ? a - b : String(a ?? "").localeCompare(String(b ?? ""));
      if (comparison) return direction === "desc" ? -comparison : comparison;
    }
    return 0;
  });
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? rows.length);
  rows = rows.slice(offset, offset + limit);
  if (request.headers.get("accept")?.includes("application/vnd.pgrst.object+json")) {
    return rows.length === 1 ? json(rows[0]) : json({ code: "PGRST116", message: "No matching sample record." }, 406);
  }
  return json(rows);
};

export const supabase = createClient<Database>(base, "local-preview-publishable-key", {
  global: { fetch: previewFetch },
  auth: { autoRefreshToken: false, persistSession: true, detectSessionInUrl: false, storageKey, storage: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } } },
});
