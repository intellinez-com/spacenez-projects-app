import { readPrivate } from "./connection.mjs";
import { targetApi } from "./api.mjs";
const credentials = readPrivate("client-onboarding.json");
let token;
try {
  const login = await targetApi("/auth/v1/token?grant_type=password", { method: "POST", body: { email: credentials.email, password: credentials.password } });
  if (!login.ok || login.data?.user?.id !== credentials.userId) throw new Error("Client login verification failed");
  token = login.data.access_token;
  const [projects, tasks, plans, roles] = await Promise.all([
    targetApi("/rest/v1/projects?select=id", { token }),
    targetApi("/rest/v1/tasks?select=id,project_id", { token }),
    targetApi("/rest/v1/task_approval_plan?select=id,project_id", { token }),
    targetApi("/rest/v1/user_roles?select=role", { token }),
  ]);
  if ([projects, tasks, plans, roles].some((result) => !result.ok) || projects.data.length !== 1 || projects.data[0].id !== credentials.projectId || tasks.data.length !== 18 || tasks.data.some((task) => task.project_id !== credentials.projectId) || plans.data.length !== 14 || plans.data.some((plan) => plan.project_id !== credentials.projectId) || roles.data.length !== 1 || roles.data[0].role !== "client") throw new Error("Client scope verification failed");
  console.log(JSON.stringify({ clientLoginVerified: true, visibleProjects: 1, visibleTasks: 18, visiblePlannedApprovals: 14, role: "client" }));
} catch { console.error(JSON.stringify({ clientVerificationFailed: true })); process.exitCode = 1; }
finally { if (token) await targetApi("/auth/v1/logout", { method: "POST", token }); }
