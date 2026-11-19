import { readFile, mkdir, writeFile } from "node:fs/promises";
import ts from "typescript";
import { openTarget, readPrivate } from "./connection.mjs";

// Reuse the application's validated import contract; keep the client plan out of the bundle/repository.
const runtime = new URL("../../.migration-private/import-runtime/", import.meta.url);
await mkdir(runtime, { recursive: true });
for (const [name, path] of [["constants", "src/lib/constants.ts"], ["meeting-url", "src/lib/meeting-url.ts"], ["project-import", "src/lib/project-import.ts"]]) {
  const source = await readFile(new URL(`../../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replaceAll('"@/lib/constants"', '"./constants.mjs"').replaceAll('"@/lib/meeting-url"', '"./meeting-url.mjs"');
  await writeFile(new URL(`${name}.mjs`, runtime), compiled);
}
const { parseProjectImport, defaultImportProject, buildProjectImport } = await import(new URL("project-import.mjs", runtime));
const { sql, config } = openTarget();
let phase = "read-plan";
try {
  const plan = parseProjectImport(await readFile(new URL("../../outputs/launch-preparation-2026-11-19/project-import-staging.json", import.meta.url), "utf8"), config.projectRef, true);
  const fields = defaultImportProject(plan);
  const payload = buildProjectImport(plan, fields);
  if (payload.p_tasks.length !== 18 || payload.p_approval_plan.length !== 14) throw new Error("Unexpected plan counts");
  const original = readPrivate("source-snapshot-2026-11-19.json");
  const admin = original.public.user_roles.find((row) => row.role === "admin")?.user_id;
  if (!admin) throw new Error("Source admin unavailable");
  phase = "atomic-import-and-retry";
  const result = await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: admin, role: "authenticated" })}, true)`;
    await tx`set local role authenticated`;
    const call = () => tx`select public.import_project_plan(${tx.json(payload.p_project)},${tx.json(payload.p_tasks)},${tx.json(payload.p_approval_plan)},${payload.p_source_sha256}) as result`;
    const first = (await call())[0].result;
    const retry = (await call())[0].result;
    if (first.project_id !== retry.project_id || retry.created || first.task_count !== 18 || first.approval_plan_count !== 14) throw new Error("Import retry verification failed");
    return { ...first, retryVerified: true };
  });
  const counts = (await sql`select (select count(*)::int from auth.users) as users,(select count(*)::int from public.projects) as projects,(select count(*)::int from public.tasks) as tasks,(select count(*)::int from public.task_approval_plan) as planned_approvals,(select count(*)::int from public.task_approvals) as actual_approvals`)[0];
  if (counts.users !== 1 || counts.projects !== 2 || counts.tasks !== 38 || counts.planned_approvals !== 14 || counts.actual_approvals !== 0) throw new Error("Unexpected destination totals");
  console.log(JSON.stringify({ imported: result, totals: counts }));
} catch (error) {
  console.error(JSON.stringify({ phase, code: error.code ?? error.name, failed: true }));
  process.exitCode = 1;
} finally { await sql.end({ timeout: 3 }); }
