// Only selected by Vite's explicit, serve-only client-preview mode. Never a production auth fallback.
import { createClient, type User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createPreviewFixtures, previewIds } from "./fixtures";
import { createPreviewFinanceSession, PreviewFinanceError } from "./finance";
import { localPreviewRole } from "./role";
import { PROJECT_TYPES, STATUSES, PRIORITIES } from "@/lib/constants";
import { safeMeetingUrl } from "@/lib/meeting-url";

export { previewIds } from "./fixtures";
export const previewRole = localPreviewRole();
const fixture = createPreviewFixtures(previewRole);
const financeProofs = new Map<string, Blob>();
const actorId = previewRole === "admin" ? previewIds.admin : previewIds.client;
const financeSessions = new Map<string, ReturnType<typeof createPreviewFinanceSession>>([
  [previewIds.project, createPreviewFinanceSession(previewRole, actorId, (path) => financeProofs.has(path))],
]);
function financeFor(projectId: unknown) {
  if (typeof projectId !== "string" || !fixture.projects.some((project) => project.id === projectId)) return null;
  if (!financeSessions.has(projectId)) financeSessions.set(projectId, createPreviewFinanceSession(previewRole, actorId, (path) => financeProofs.has(path)));
  return financeSessions.get(projectId)!;
}
function financeForPayment(paymentId: unknown) {
  if (typeof paymentId === "string") {
    for (const session of financeSessions.values()) {
      if (session.read().payments.some((payment) => payment.id === paymentId)) return session;
    }
  }
  return financeSessions.get(previewIds.project)!;
}
export function localFinanceProof(projectId: string, path: string): Blob {
  const proof = financeProofs.get(path);
  if (!fixture.projects.some((project) => project.id === projectId) || !path.startsWith(`${projectId}/`) || !proof) throw new Error("Sample payment proof not found.");
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
type PreviewProject = (typeof fixture.projects)[number];
type PreviewActivity = Database["public"]["Tables"]["project_activity"]["Row"];
type PreviewStage = (typeof fixture.project_stages)[number];
const taskFields = ["title", "description", "status", "stage", "priority", "assignee_id", "start_date", "due_date", "position"] as const;
const projectEditableFields = ["name", "client_name", "client_brand", "client_email", "location", "project_type", "description", "start_date", "target_date", "meeting_url", "current_stage"] as const;
const projectActivityFields = ["name", "location", "project_type", "description", "current_stage", "status", "start_date", "target_date"] as const;
function isValidDate(value: unknown) {
  return value === null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
}
function isAdminActor() {
  return previewRole === "admin" && fixture.user_roles.some((role) => role.user_id === actorId && role.role === "admin");
}
function validTask(task: PreviewTask) {
  return typeof task.title === "string" && !!task.title.trim() && (task.description === null || typeof task.description === "string")
    && fixture.project_stages.some((stage) => stage.project_id === task.project_id && stage.key === task.stage && stage.archived_at === null) && STATUSES.some((status) => status.key === task.status) && PRIORITIES.some((priority) => priority.key === task.priority)
    && (task.assignee_id === null || fixture.profiles.some((profile) => profile.id === task.assignee_id))
    && isValidDate(task.start_date) && isValidDate(task.due_date) && typeof task.position === "number" && Number.isFinite(task.position) && task.position >= 0;
}
function taskActivityEvent(task: PreviewTask, previous?: PreviewTask, stages = fixture.project_stages): PreviewActivity | null {
  const changes = previous ? Object.fromEntries(taskFields.filter((field) => previous[field] !== task[field]).map((field) => [field, { from: previous[field], to: task[field] }])) : {};
  if (previous && !Object.keys(changes).length) return null;
  const stageName = (key: string) => stages.find((stage) => stage.project_id === task.project_id && stage.key === key)?.label ?? key;
  return { id: crypto.randomUUID(), project_id: task.project_id, actor_id: actorId, kind: previous ? "task_updated" : "task_created", occurred_at: task.updated_at, source_type: "tasks", source_id: task.id, task_id: task.id, payload: { title: task.title, status: task.status, stage: task.stage, stage_label: stageName(task.stage), changes, ...(previous && previous.stage !== task.stage ? { stage_labels: { stage: { from: stageName(previous.stage), to: stageName(task.stage) } } } : {}) } };
}
function taskActivity(task: PreviewTask, previous?: PreviewTask) {
  const event = taskActivityEvent(task, previous);
  if (event) fixture.project_activity.push(event);
}
function projectStageActivity(project: PreviewProject, previousStage: string, now: string, stages = fixture.project_stages): PreviewActivity {
  const label = (key: string) => stages.find((stage) => stage.project_id === project.id && stage.key === key)?.label ?? key;
  return { id: crypto.randomUUID(), project_id: project.id, actor_id: actorId, kind: "project_updated", occurred_at: now, source_type: "projects", source_id: project.id, task_id: null, payload: { name: project.name, changes: { current_stage: { from: previousStage, to: project.current_stage } }, stage_labels: { current_stage: { from: label(previousStage), to: label(project.current_stage) } } } };
}

class PreviewStageError extends Error {
  constructor(message: string, readonly code = "22023") { super(message); }
}
type StageResult = { version: number; stage_key?: string };
const stageRequests = new Map<string, { actorId: string; expectedVersion: number; action: string; result: StageResult }>();
type DuplicateResult = { project_id: string; created: boolean; task_count: number; approval_plan_count: number; stage_count: number };
const duplicateRequests = new Map<string, { actorId: string; sourceProjectId: string; projectId: string; fieldsJson: string; taskCount: number; approvalPlanCount: number; stageCount: number }>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function duplicateProject(body: Record<string, unknown>): DuplicateResult {
  if (!isAdminActor()) throw new PreviewStageError("Only admins can duplicate a project.", "42501");
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["p_source_project_id", "p_request_id", "p_project"].includes(key))) {
    throw new PreviewStageError("A source, request ID and new project details are required.");
  }
  const sourceId = body["p_source_project_id"], requestId = body["p_request_id"], rawProject = body["p_project"];
  if (typeof sourceId !== "string" || !uuid.test(sourceId) || typeof requestId !== "string" || !uuid.test(requestId) || !rawProject || typeof rawProject !== "object" || Array.isArray(rawProject)) {
    throw new PreviewStageError("A source, request ID and new project details are required.");
  }
  const allowedFields = ["name", "client_name", "client_brand", "client_email", "location", "project_type", "description"];
  const projectInput = rawProject as Record<string, unknown>;
  for (const [key, value] of Object.entries(projectInput)) {
    if (!allowedFields.includes(key) || (value !== null && typeof value !== "string")) {
      throw new PreviewStageError("Only the new project details may be supplied.");
    }
  }
  const trimOrNull = (value: unknown) => {
    const text = typeof value === "string" ? value.trim() : "";
    return text || null;
  };
  const name = typeof projectInput["name"] === "string" ? projectInput["name"].trim() : "";
  const clientName = trimOrNull(projectInput["client_name"]);
  const clientBrand = trimOrNull(projectInput["client_brand"]);
  const rawEmail = trimOrNull(projectInput["client_email"]);
  const clientEmail = rawEmail ? rawEmail.toLowerCase() : null;
  const location = trimOrNull(projectInput["location"]);
  const projectType = trimOrNull(projectInput["project_type"]) ?? "Other";
  const description = trimOrNull(projectInput["description"]);
  if (name.length < 1 || name.length > 200 || (clientName?.length ?? 0) > 200 || (clientBrand?.length ?? 0) > 200
    || (clientEmail?.length ?? 0) > 320 || (location?.length ?? 0) > 500 || (description?.length ?? 0) > 20_000
    || !PROJECT_TYPES.includes(projectType) || (clientEmail !== null && !emailPattern.test(clientEmail))) {
    throw new PreviewStageError("Enter a new project name and valid project details.");
  }
  const fields = { name, client_name: clientName, client_brand: clientBrand, client_email: clientEmail, location, project_type: projectType, description };
  const fieldsJson = canonicalJson(fields);
  const savedKey = requestId.toLowerCase();
  const previous = duplicateRequests.get(savedKey);
  if (previous) {
    if (previous.actorId !== actorId || previous.sourceProjectId !== sourceId) throw new PreviewStageError("This duplication request belongs to another operation.", "42501");
    if (previous.fieldsJson !== fieldsJson) throw new PreviewStageError("This request already used different project details. Check Projects before starting another copy.", "23505");
    if (!fixture.projects.some((project) => project.id === previous.projectId)) throw new PreviewStageError("This copied project was removed. Start a new duplication request.", "55000");
    return { project_id: previous.projectId, created: false, task_count: previous.taskCount, approval_plan_count: previous.approvalPlanCount, stage_count: previous.stageCount };
  }
  const source = fixture.projects.find((project) => project.id === sourceId);
  if (!source) throw new PreviewStageError("Source project not found or access denied.", "42501");
  const sourceStages = fixture.project_stages
    .filter((stage) => stage.project_id === sourceId && stage.archived_at === null)
    .sort((left, right) => left.position - right.position || left.key.localeCompare(right.key));
  const sourceTasks = fixture.tasks
    .filter((task) => task.project_id === sourceId)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  const sourceApprovals = fixture.task_approval_plan
    .filter((plan) => plan.project_id === sourceId)
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
  if (sourceStages.length === 0 || sourceStages.length > 100 || sourceTasks.length > 5000 || sourceApprovals.length > 5000) {
    throw new PreviewStageError("The source plan has no active headings or is too large to duplicate.");
  }
  if (sourceTasks.some((task) => !sourceStages.some((stage) => stage.key === task.stage))) {
    throw new PreviewStageError("The source contains tasks outside its active headings. Refresh the source project before duplicating.");
  }
  const newProjectId = crypto.randomUUID();
  const now = new Date().toISOString();
  const newProject: PreviewProject = {
    id: newProjectId, name, client_name: clientName, client_brand: clientBrand, client_email: clientEmail,
    location, project_type: projectType, description, status: "active", current_stage: sourceStages[0]!.key,
    stage_revision: 0, start_date: null, target_date: null, meeting_url: null, created_at: now, created_by: actorId,
  };
  const copiedStages: PreviewStage[] = sourceStages.map((stage) => ({
    project_id: newProjectId, key: stage.key, label: stage.label, position: stage.position, archived_at: null,
  }));
  const taskIdMap = new Map<string, string>();
  const copiedTasks: PreviewTask[] = [];
  const events: PreviewActivity[] = [];
  for (const sourceTask of sourceTasks) {
    const newTaskId = crypto.randomUUID();
    const copied: PreviewTask = {
      id: newTaskId, project_id: newProjectId, title: sourceTask.title, description: sourceTask.description,
      stage: sourceTask.stage, priority: sourceTask.priority, position: sourceTask.position, status: "not_started",
      assignee_id: null, start_date: null, due_date: null, created_by: actorId, created_at: now, updated_at: now,
      content_revision: 1, source_id: null, source_metadata: {},
    };
    taskIdMap.set(sourceTask.id, newTaskId);
    copiedTasks.push(copied);
    const createdEvent = taskActivityEvent(copied, undefined, copiedStages);
    if (createdEvent) events.push(createdEvent);
  }
  const copiedApprovals: Database["public"]["Tables"]["task_approval_plan"]["Row"][] = [];
  for (const plan of sourceApprovals) {
    const mappedTaskId = taskIdMap.get(plan.task_id);
    if (!mappedTaskId) throw new PreviewStageError("A source review has no task in the copied plan.");
    copiedApprovals.push({
      id: crypto.randomUUID(), project_id: newProjectId, task_id: mappedTaskId,
      source_id: `duplicate-plan-${crypto.randomUUID()}`, stage_gate: plan.stage_gate, milestone: plan.milestone,
      description: plan.description, source_metadata: {}, created_at: now,
    });
  }
  fixture.projects.unshift(newProject);
  fixture.project_stages.push(...copiedStages);
  fixture.tasks.push(...copiedTasks);
  fixture.task_approval_plan.push(...copiedApprovals);
  fixture.project_activity.push(...events);
  duplicateRequests.set(savedKey, {
    actorId, sourceProjectId: sourceId, projectId: newProjectId, fieldsJson,
    taskCount: copiedTasks.length, approvalPlanCount: copiedApprovals.length, stageCount: copiedStages.length,
  });
  return {
    project_id: newProjectId, created: true,
    task_count: copiedTasks.length, approval_plan_count: copiedApprovals.length, stage_count: copiedStages.length,
  };
}
function mutateProjectStages(body: Record<string, unknown>): StageResult {
  if (!isAdminActor()) throw new PreviewStageError("Administrator access required.", "42501");
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["p_project_id", "p_expected_version", "p_request_id", "p_action"].includes(key))) throw new PreviewStageError("A request ID, heading version and action are required.");
  const project = fixture.projects.find((entry) => entry.id === body["p_project_id"]);
  if (!project) throw new PreviewStageError("Project not found or access denied.", "42501");
  const expectedVersion = body["p_expected_version"], requestId = body["p_request_id"], input = body["p_action"];
  if (typeof expectedVersion !== "number" || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion > 2147483647 || typeof requestId !== "string" || !uuid.test(requestId) || !input || typeof input !== "object" || Array.isArray(input)) throw new PreviewStageError("A request ID, heading version and action are required.");
  const action = input as Record<string, unknown>, savedKey = `${project.id}/${requestId.toLowerCase()}`, actionJson = canonicalJson(action);
  const previous = stageRequests.get(savedKey);
  if (previous) {
    if (previous.actorId !== actorId || previous.expectedVersion !== expectedVersion || previous.action !== actionJson) throw new PreviewStageError("This request ID was already used for another action.", "23505");
    return previous.result;
  }
  if (project.stage_revision !== expectedVersion) throw new PreviewStageError("Project headings changed. Refresh and try again.", "40001");
  const type = action["type"];
  if (typeof type !== "string" || !["add", "rename", "reorder", "archive"].includes(type)) throw new PreviewStageError("Choose a supported heading action.");
  const allowed = type === "reorder" ? ["type", "keys"] : type === "archive" ? ["type", "key", "move_to"] : ["type", "key", "label"];
  if (Object.keys(action).some((key) => !allowed.includes(key))) throw new PreviewStageError("Unexpected heading action field.");
  const nextStages = fixture.project_stages.map((stage) => ({ ...stage })), nextTasks = fixture.tasks.map((task) => ({ ...task })), nextProject = { ...project };
  const active = nextStages.filter((stage) => stage.project_id === project.id && stage.archived_at === null).sort((left, right) => left.position - right.position || left.key.localeCompare(right.key));
  const now = new Date().toISOString(), events: PreviewActivity[] = [];
  let key: string | undefined;
  let headingEvent: { type: "added"; key: string; label: string } | { type: "renamed"; key: string; label: string; previous_label: string } | { type: "removed"; key: string; label: string; moved_tasks: number; move_to: string | null; move_to_label: string | null } | { type: "reordered"; order: string[] };
  let label = "";
  if (type === "add" || type === "rename") {
    if (typeof action["label"] !== "string") throw new PreviewStageError("Enter a heading name.");
    label = action["label"].replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
    if (!/\S/.test(label) || Array.from(label).length > 120) throw new PreviewStageError("Heading names must contain 1 to 120 characters.");
  }
  if (type === "add") {
    const newKey = action["key"] ?? `custom_${crypto.randomUUID().replace(/-/g, "")}`;
    if (typeof newKey !== "string" || !/^custom_[0-9a-f]{32}$/.test(newKey)) throw new PreviewStageError("Invalid new heading key.");
    key = newKey;
    if (nextStages.some((stage) => stage.project_id === project.id && (stage.key === key || (stage.archived_at === null && stage.label.trim().toLowerCase() === label.trim().toLowerCase())))) throw new PreviewStageError("A heading with that name or identity already exists.", "23505");
    nextStages.push({ project_id: project.id, key, label, position: Math.max(-1, ...nextStages.filter((stage) => stage.project_id === project.id).map((stage) => stage.position)) + 1, archived_at: null });
    headingEvent = { type: "added", key, label };
  } else if (type === "rename" || type === "archive") {
    const heading = active.find((stage) => stage.key === action["key"]);
    if (!heading) throw new PreviewStageError("Choose an active project heading.");
    key = heading.key;
    if (type === "rename") {
      if (heading.label === label) throw new PreviewStageError("This heading already has that name.");
      if (active.some((stage) => stage.key !== key && stage.label.trim().toLowerCase() === label.trim().toLowerCase())) throw new PreviewStageError("A heading with that name already exists.", "23505");
      headingEvent = { type: "renamed", key, label, previous_label: heading.label };
      heading.label = label;
    } else {
      if (active.length <= 1) throw new PreviewStageError("Keep at least one active project heading.");
      const toMove = nextTasks.filter((task) => task.project_id === project.id && task.stage === key);
      let destination: PreviewStage | undefined;
      if (toMove.length > 0 || nextProject.current_stage === key || Object.prototype.hasOwnProperty.call(action, "move_to")) {
        destination = active.find((stage) => stage.key === action["move_to"] && stage.key !== key);
        if (!destination) throw new PreviewStageError("Choose another active heading to move work and the current project stage into.");
      }
      for (const task of toMove) {
        const old = { ...task };
        task.stage = destination!.key; task.content_revision += 1; task.updated_at = now;
        const event = taskActivityEvent(task, old, nextStages); if (event) events.push(event);
      }
      if (nextProject.current_stage === key) { const previousStage = nextProject.current_stage; nextProject.current_stage = destination!.key; events.push(projectStageActivity(nextProject, previousStage, now, nextStages)); }
      heading.archived_at = now;
      headingEvent = { type: "removed", key, label: heading.label, moved_tasks: toMove.length, move_to: destination?.key ?? null, move_to_label: destination?.label ?? null };
    }
  } else {
    const keys = action["keys"];
    if (!Array.isArray(keys) || keys.some((value) => typeof value !== "string") || keys.length !== active.length || new Set(keys).size !== active.length || keys.some((value) => !active.some((stage) => stage.key === value))) throw new PreviewStageError("Provide every active heading once in its new order.");
    if (keys.every((value, index) => value === active[index]?.key)) throw new PreviewStageError("The heading order is unchanged.");
    keys.forEach((value, position) => { active.find((stage) => stage.key === value)!.position = position; });
    headingEvent = { type: "reordered", order: keys.map((value) => active.find((stage) => stage.key === value)!.label) };
  }
  nextProject.stage_revision += 1;
  const result: StageResult = { version: nextProject.stage_revision, ...(key ? { stage_key: key } : {}) };
  events.push({ id: crypto.randomUUID(), project_id: project.id, actor_id: actorId, kind: "project_updated", occurred_at: now, source_type: "projects", source_id: project.id, task_id: null, payload: { name: project.name, heading_change: headingEvent } });
  // Commit only after every action/move validation has succeeded.
  fixture.project_stages.splice(0, fixture.project_stages.length, ...nextStages);
  fixture.tasks.splice(0, fixture.tasks.length, ...nextTasks);
  Object.assign(project, nextProject);
  fixture.project_activity.push(...events);
  stageRequests.set(savedKey, { actorId, expectedVersion, action: actionJson, result });
  return result;
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
    const parts = filePath.split("/");
    const finance = financeFor(parts[0]);
    if (!finance || !finance.read().configured || parts.length !== 3 || parts[1] !== actorId) return denied();
    const uploaded = request.headers.get("content-type")?.startsWith("multipart/")
      ? Array.from((await request.formData()).values()).find((value): value is File => typeof value !== "string")
      : await request.blob();
    if (!uploaded || uploaded.size === 0 || uploaded.size > 5 * 1024 * 1024 || !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(uploaded.type)) return denied("Use a PDF, PNG, JPEG or WebP up to 5 MB.");
    financeProofs.set(filePath, uploaded);
    return json({ Key: `project-finance/${filePath}`, Id: crypto.randomUUID() });
  }
  if (path === "/storage/v1/object/project-finance" && request.method === "DELETE") {
    const paths = body["prefixes"];
    const referenced = new Set(Array.from(financeSessions.values()).flatMap((session) => session.read().payments.map((payment) => payment.proof_path).filter((value): value is string => !!value)));
    if (!Array.isArray(paths) || paths.some((value) => typeof value !== "string" || !financeProofs.has(value) || referenced.has(value))) return denied();
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
    if (rpc === "duplicate_project" && request.method === "POST") {
      try { return json(duplicateProject(body)); }
      catch (error) {
        const code = error instanceof PreviewStageError ? error.code : "22023";
        const message = error instanceof Error ? error.message : "Invalid sample project duplication.";
        return json({ code, message, error: message }, code === "42501" ? 403 : ["23505", "40001", "55000"].includes(code) ? 409 : 400);
      }
    }
    if (rpc === "mutate_project_stages" && request.method === "POST") {
      try { return json(mutateProjectStages(body)); }
      catch (error) {
        const code = error instanceof PreviewStageError ? error.code : "22023";
        const message = error instanceof Error ? error.message : "Invalid sample heading action.";
        return json({ code, message, error: message }, code === "42501" ? 403 : ["23505", "40001"].includes(code) ? 409 : 400);
      }
    }
    if (rpc === "get_project_task_people" && request.method === "POST") {
      const targetProjectId = body && typeof body === "object" && !Array.isArray(body) ? body["p_project_id"] : null;
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "p_project_id") || typeof targetProjectId !== "string" || !fixture.projects.some((project) => project.id === targetProjectId)) return denied("Choose a sample project to load its task owners.");
      const isAdmin = fixture.user_roles.some((role) => role.user_id === actorId && role.role === "admin");
      const membership = fixture.project_members.find((member) => member.project_id === targetProjectId && member.user_id === actorId);
      if (!fixture.profiles.some((profile) => profile.id === actorId) || (!isAdmin && !membership)) return denied("You do not have access to this sample project.");
      const canEdit = isAdmin || membership?.access === "partner";
      const eligible = new Set<string>([
        ...fixture.project_members.filter((member) => member.project_id === targetProjectId).map((member) => member.user_id),
        ...fixture.tasks.filter((task) => task.project_id === targetProjectId && task.assignee_id).map((task) => task.assignee_id!),
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
      const finance = ["get_project_finance", "save_project_finance", "record_project_payment"].includes(rpc)
        ? financeFor(body["p_project_id"])
        : financeForPayment(body["p_payment_id"]);
      if (!finance) return denied();
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
  if (table === "projects" && request.method === "PATCH") {
    const idFilter = url.searchParams.get("id");
    if (!isAdminActor() || !body || typeof body !== "object" || Array.isArray(body) || !Object.keys(body).length || !idFilter?.startsWith("eq.")) return denied("Only the local admin can update sample project details.");
    if (Object.keys(body).some((field) => !projectEditableFields.some((allowed) => allowed === field))) return denied("Only editable sample project fields can be changed.");
    const project = fixture.projects.find((entry) => `eq.${entry.id}` === idFilter);
    if (!project) return denied("Sample project not found.");
    for (const [param, filter] of url.searchParams) {
      if (param === "id" || param === "select") continue;
      if (!projectEditableFields.some((allowed) => allowed === param)) return denied("Unsupported sample project filter.");
      const current = project[param as keyof PreviewProject];
      if (filter === "is.null" ? current !== null : filter.startsWith("eq.") ? String(current ?? "") !== filter.slice(3) || current === null : true) {
        return mutationResponse(request, []);
      }
    }
    const previous = { ...project };
    const next: PreviewProject = { ...project };
    for (const [field, value] of Object.entries(body)) {
      if (field === "name") {
        if (typeof value !== "string" || !value.trim() || value.trim().length > 200) return denied("Enter a valid project name.");
        next.name = value.trim();
      } else if (field === "current_stage") {
        if (typeof value !== "string" || !fixture.project_stages.some((stage) => stage.project_id === project.id && stage.key === value && stage.archived_at === null)) return denied("Choose an active project heading.");
        next.current_stage = value;
      } else if (field === "project_type") {
        if (typeof value !== "string" || !PROJECT_TYPES.includes(value)) return denied("Choose a valid project type.");
        next.project_type = value;
      } else if (field === "start_date" || field === "target_date") {
        if (!isValidDate(value)) return denied("Enter valid project dates.");
        next[field] = value as string | null;
      } else if (field === "meeting_url") {
        if (value !== null && (typeof value !== "string" || !safeMeetingUrl(value))) return denied("Enter a valid Calendly booking link.");
        next.meeting_url = value as string | null;
      } else if (field === "client_email") {
        if (value !== null && (typeof value !== "string" || !emailPattern.test(value.trim()))) return denied("Enter a valid client email.");
        next.client_email = typeof value === "string" ? value.trim().toLowerCase() : null;
      } else {
        if (value !== null && typeof value !== "string") return denied("Enter valid project details.");
        (next as Record<string, unknown>)[field] = typeof value === "string" ? value.trim() || null : null;
      }
    }
    if (next.start_date && next.target_date && next.target_date < next.start_date) return denied("Target handover must be on or after the start date.");
    const now = new Date().toISOString();
    const changes = Object.fromEntries(projectActivityFields.filter((field) => previous[field] !== next[field]).map((field) => [field, { from: previous[field], to: next[field] }]));
    Object.assign(project, next);
    if (Object.keys(changes).length) {
      const stageName = (key: string) => fixture.project_stages.find((stage) => stage.project_id === project.id && stage.key === key)?.label ?? key;
      fixture.project_activity.push({
        id: crypto.randomUUID(), project_id: project.id, actor_id: actorId, kind: "project_updated", occurred_at: now,
        source_type: "projects", source_id: project.id, task_id: null,
        payload: { name: project.name, changes, ...(previous.current_stage !== next.current_stage ? { stage_labels: { current_stage: { from: stageName(previous.current_stage), to: stageName(next.current_stage) } } } : {}) },
      });
    }
    return mutationResponse(request, [project]);
  }
  if (table === "tasks" && (request.method === "POST" || request.method === "PATCH" || request.method === "DELETE")) {
    if (!isAdminActor()) return denied("Only the local admin can edit sample tasks.");
    if (request.method === "DELETE") {
      const projectFilter = url.searchParams.get("project_id");
      const idFilter = url.searchParams.get("id");
      if (!projectFilter?.startsWith("eq.") || !idFilter?.startsWith("eq.") || Array.from(url.searchParams.keys()).some((key) => !["id", "project_id", "select"].includes(key))) return denied("Choose one task in a sample project before deleting it.");
      const targetProjectId = projectFilter.slice(3);
      if (!fixture.projects.some((project) => project.id === targetProjectId)) return denied("Choose one task in a sample project before deleting it.");
      const index = fixture.tasks.findIndex((entry) => entry.project_id === targetProjectId && `eq.${entry.id}` === idFilter);
      if (index < 0) return mutationResponse(request, []);
      const task = fixture.tasks[index]!;
      if (fixture.task_approvals.some((approval) => approval.task_id === task.id)) return denied("Tasks with approval history must be retained.");
      fixture.tasks.splice(index, 1);
      for (let i = fixture.comments.length - 1; i >= 0; i--) if (fixture.comments[i]!.task_id === task.id) fixture.comments.splice(i, 1);
      for (let i = fixture.task_approval_plan.length - 1; i >= 0; i--) if (fixture.task_approval_plan[i]!.task_id === task.id) fixture.task_approval_plan.splice(i, 1);
      for (const document of fixture.documents) if (document.task_id === task.id) document.task_id = null;
      const stageName = fixture.project_stages.find((stage) => stage.project_id === task.project_id && stage.key === task.stage)?.label ?? task.stage;
      fixture.project_activity.push({ id: crypto.randomUUID(), project_id: task.project_id, actor_id: actorId, kind: "task_deleted", occurred_at: new Date().toISOString(), source_type: "tasks", source_id: task.id, task_id: task.id, payload: { title: task.title, status: task.status, stage: task.stage, stage_label: stageName } });
      return mutationResponse(request, [task]);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return denied("Only the local admin can edit sample tasks.");
    const allowed = request.method === "POST" ? [...taskFields, "project_id", "created_by"] : taskFields;
    if (Object.keys(body).some((field) => !allowed.some((allowedField) => allowedField === field))) return denied("Only editable sample task fields can be changed.");
    if (request.method === "POST") {
      const targetProjectId = body["project_id"];
      if (typeof targetProjectId !== "string" || !fixture.projects.some((project) => project.id === targetProjectId) || body["created_by"] !== actorId) return denied("The sample task must belong to this project and admin.");
      const now = new Date().toISOString();
      const projectTasks = fixture.tasks.filter((entry) => entry.project_id === targetProjectId);
      const task: PreviewTask = {
        id: crypto.randomUUID(), project_id: targetProjectId, created_by: actorId, title: "", description: null, stage: "planning", status: "not_started", priority: "medium", assignee_id: null, start_date: null, due_date: null,
        position: Math.max(-1, ...projectTasks.map((entry) => entry.position)) + 1, created_at: now, updated_at: now, content_revision: 1, source_id: null, source_metadata: {},
        ...body,
      };
      if (!validTask(task)) return denied("Enter a valid sample task title, stage, owner and dates.");
      task.title = task.title.trim();
      fixture.tasks.push(task);
      taskActivity(task);
      return mutationResponse(request, [task], 201);
    }
    const projectFilter = url.searchParams.get("project_id");
    const idFilter = url.searchParams.get("id");
    if (!projectFilter?.startsWith("eq.") || !idFilter?.startsWith("eq.") || Array.from(url.searchParams.keys()).some((key) => !["id", "project_id", "select"].includes(key))) return denied("Choose one task in the sample project before updating it.");
    const targetProjectId = projectFilter.slice(3);
    if (!fixture.projects.some((project) => project.id === targetProjectId)) return denied("Choose one task in the sample project before updating it.");
    const task = fixture.tasks.find((entry) => entry.project_id === targetProjectId && `eq.${entry.id}` === idFilter);
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
    const projectId = body["project_id"];
    const taskId = body["task_id"];
    const canCommentProject = typeof projectId === "string" && fixture.projects.some((project) => project.id === projectId)
      && (isAdminActor() || fixture.project_members.some((member) => member.project_id === projectId && member.user_id === actorId));
    if (!canCommentProject || body["user_id"] !== actorId || typeof body["body"] !== "string" || !body["body"].trim() || (taskId !== null && !fixture.tasks.some((task) => task.id === taskId && task.project_id === projectId))) return denied("The sample comment is invalid.");
    const comment = { id: crypto.randomUUID(), project_id: projectId, task_id: typeof taskId === "string" ? taskId : null, user_id: actorId, body: body["body"].trim(), created_at: new Date().toISOString() };
    fixture.comments.push(comment);
    fixture.project_activity.push({ id: crypto.randomUUID(), project_id: projectId, actor_id: actorId, kind: "comment_added", occurred_at: comment.created_at, source_type: "comments", source_id: comment.id, task_id: comment.task_id, payload: { body: comment.body, task_title: fixture.tasks.find((task) => task.id === comment.task_id)?.title ?? null } });
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
