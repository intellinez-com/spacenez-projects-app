// Only selected by Vite's explicit, serve-only client-preview mode. Never a production auth fallback.
import { createClient, type User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createPreviewFixtures, previewIds } from "./fixtures";

export { previewIds } from "./fixtures";
const fixture = createPreviewFixtures();
const base = typeof window === "undefined" ? "http://127.0.0.1:4173" : window.location.origin;
const storageKey = "spacenez-local-client-preview";
export const previewUser: User = {
  id: previewIds.client, aud: "authenticated", role: "authenticated", email: "client@example.test",
  app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: "Sample Client" },
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
  const body = request.method === "GET" || request.method === "HEAD" ? {} : await request.json().catch(() => ({})) as Record<string, unknown>;
  if (path.startsWith("/auth/v1/")) {
    if (path === "/auth/v1/user" && request.method === "GET") return json(previewUser);
    if (path === "/auth/v1/token" && request.method === "POST") {
      if (url.searchParams.get("grant_type") !== "refresh_token" && (body["email"] !== "client@example.test" || body["password"] !== "preview-client")) return json({ msg: "Use client@example.test and preview-client for this local preview." }, 400);
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
  if (path.startsWith("/rest/v1/rpc/")) {
    const rpc = path.slice("/rest/v1/rpc/".length);
    if (rpc === "respond_task_approval" && request.method === "POST") {
      const approval = fixture.task_approvals.find((entry) => entry.id === body["p_approval_id"]);
      const decision = body["p_decision"];
      const feedback = typeof body["p_feedback"] === "string" ? body["p_feedback"].trim() : null;
      if (!approval || approval.state !== "pending" || !["approved", "changes_requested"].includes(String(decision))) return denied("This sample approval is no longer available. Reload to reset it.");
      if (decision === "changes_requested" && !feedback) return denied("Describe the changes needed before submitting.");
      approval.state = decision as "approved" | "changes_requested"; approval.decided_by = previewIds.client; approval.decided_at = new Date().toISOString(); approval.feedback = feedback;
      return json(approval);
    }
    if (rpc === "has_role") return json(body["_role"] === "client");
    return denied();
  }
  if (!path.startsWith("/rest/v1/")) return denied("Unknown local preview endpoint.");
  const table = path.slice("/rest/v1/".length);
  if (request.method === "POST" && table === "comments") {
    const taskId = body["task_id"];
    if (body["project_id"] !== previewIds.project || body["user_id"] !== previewIds.client || typeof body["body"] !== "string" || !body["body"].trim() || (taskId !== null && !fixture.tasks.some((task) => task.id === taskId))) return denied("The sample comment is invalid.");
    const comment = { id: crypto.randomUUID(), project_id: previewIds.project, task_id: typeof taskId === "string" ? taskId : null, user_id: previewIds.client, body: body["body"].trim(), created_at: new Date().toISOString() };
    fixture.comments.push(comment);
    fixture.project_activity.push({ id: crypto.randomUUID(), project_id: previewIds.project, actor_id: previewIds.client, kind: "comment_added", occurred_at: comment.created_at, source_type: "comments", source_id: comment.id, task_id: comment.task_id, payload: { body: comment.body, task_title: fixture.tasks.find((task) => task.id === comment.task_id)?.title ?? null } });
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
