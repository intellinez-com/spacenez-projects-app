import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTarget, readPrivate } from "./connection.mjs";
import { targetApi } from "./api.mjs";

const { sql } = openTarget();
let createdId, phase = "read-client-plan";
function protectCredentials(value) {
  execFileSync("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ["-NoProfile", "-File", fileURLToPath(new URL("./private-file.ps1", import.meta.url)), "-Mode", "save", "-Path", fileURLToPath(new URL("../../.migration-private/client-onboarding.json", import.meta.url))], { input: JSON.stringify(value), windowsHide: true });
}
try {
  const plan = JSON.parse(await readFile(new URL("../../outputs/launch-preparation-2026-11-19/project-import-staging.json", import.meta.url), "utf8"));
  const email = plan.project_metadata.client_email.trim().toLowerCase();
  const fullName = plan.project_metadata.client_name;
  if (!email || !fullName || plan.proposed_client_profile.requested_project_access !== "client") throw new Error("Missing authorised client details");
  const project = (await sql`select id from public.projects where lower(client_email)=${email} and name=${plan.project_metadata.project_name}`);
  if (project.length !== 1) throw new Error("Expected one imported client project");
  const existing = await sql`select id from auth.users where lower(email)=${email}`;
  if (existing.length) {
    const original = readPrivate("source-snapshot-2026-11-19.json");
    if (original.auth.users.some((user) => user.id === existing[0].id)) throw new Error("Client address belongs to an original account; manual review required");
    const linked = await sql`select exists(select 1 from public.project_members where project_id=${project[0].id} and user_id=${existing[0].id} and access='client') as linked`;
    const credentials = readPrivate("client-onboarding.json");
    const roles = await sql`select role from public.user_roles where user_id=${existing[0].id}`;
    const memberships = await sql`select project_id,access from public.project_members where user_id=${existing[0].id}`;
    if (!linked[0].linked || credentials.userId !== existing[0].id || credentials.projectId !== project[0].id || credentials.email !== email || !credentials.password || roles.length !== 1 || roles[0].role !== 'client' || memberships.length !== 1 || memberships[0].project_id !== project[0].id || memberships[0].access !== 'client') throw new Error("Existing account or protected credentials require review");
    console.log(JSON.stringify({ clientAlreadyCreated: true, projectLinked: true, credentialsProtected: true, role: "client" }));
  } else {
    phase = "create-client";
    const password = randomBytes(24).toString("base64url") + "aA1!";
    createdId = randomUUID();
    const credentials = { email, password, fullName, projectId: project[0].id, userId: createdId, createdAt: new Date().toISOString() };
    // Persist the chosen ID/password before the network request so an interrupted
    // response cannot leave an account with an unrecoverable random password.
    protectCredentials(credentials);
    const result = await targetApi("/auth/v1/admin/users", { privileged: true, method: "POST", body: { id: createdId, email, password, email_confirm: true, user_metadata: { full_name: fullName, company: plan.project_metadata.client_brand } } });
    if (!result.ok || (result.data?.id ?? result.data?.user?.id) !== createdId) throw new Error("Client creation failed");
    phase = "assign-client-access";
    await sql.begin(async (tx) => {
      await tx`delete from public.user_roles where user_id=${createdId}`;
      await tx`insert into public.user_roles(user_id,role) values (${createdId},'client')`;
      await tx`insert into public.project_members(project_id,user_id,access) values (${project[0].id},${createdId},'client')`;
    });
    phase = "verify-client-read-access";
    const login = await targetApi("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
    if (!login.ok || login.data?.user?.id !== createdId) throw new Error("Client login failed");
    const token = login.data.access_token;
    const projects = await targetApi("/rest/v1/projects?select=id", { token });
    const tasks = await targetApi("/rest/v1/tasks?select=id,project_id", { token });
    const plans = await targetApi("/rest/v1/task_approval_plan?select=id,project_id", { token });
    if (!projects.ok || projects.data.length !== 1 || projects.data[0].id !== project[0].id || !tasks.ok || tasks.data.length !== 18 || tasks.data.some((task) => task.project_id !== project[0].id) || !plans.ok || plans.data.length !== 14) throw new Error("Client scope verification failed");
    const roles = await sql`select role from public.user_roles where user_id=${createdId}`;
    if (roles.length !== 1 || roles[0].role !== "client") throw new Error("Unexpected client role");
    await targetApi("/auth/v1/logout", { method: "POST", token });
    phase = "protect-client-credentials";
    protectCredentials(credentials);
    console.log(JSON.stringify({ clientCreated: true, projectLinked: true, loginVerified: true, visibleProjects: 1, visibleTasks: 18, visiblePlannedApprovals: 14, credentialsProtected: true, emailSent: false }));
    createdId = undefined;
  }
} catch (error) {
  if (createdId) {
    const removed = await targetApi(`/auth/v1/admin/users/${createdId}`, { privileged: true, method: "DELETE" });
    if (!removed.ok && removed.status !== 404) console.error(JSON.stringify({ cleanupIncomplete: true }));
  }
  console.error(JSON.stringify({ phase, failed: true, code: error.code ?? error.name }));
  process.exitCode = 1;
} finally { await sql.end({ timeout: 3 }); }
