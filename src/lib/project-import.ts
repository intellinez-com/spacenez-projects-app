import { z } from "zod";
import { PROJECT_TYPES, STAGES } from "@/lib/constants";
import { normalizeMeetingUrl } from "@/lib/meeting-url";

const text = z.string().max(20_000);
const nullableText = text.nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Use a valid calendar date");
const nullableDate = date.nullable();
const sourceId = z.string().min(1).max(100);
const originalTask = z.object({
  id: sourceId, stage: text, title: text, acceptance_criteria: nullableText,
  responsible: nullableText, start_date: nullableText, due_date: nullableText,
  status: z.literal("Not Started"), completed_on: z.null(),
  client_approval: z.literal("Not Requested"), evidence_link: nullableText, remarks: nullableText,
}).strict();
const task = z.object({
  source_id: sourceId, source_sheet: text.min(1), source_row: z.number().int().positive(),
  original: originalTask,
  proposed_task: z.object({
    title: text.min(1), description: nullableText,
    stage: z.string().refine((value) => STAGES.some((stage) => stage.key === value), "Unknown project stage"),
    status: z.literal("not_started"), priority: z.enum(["low", "medium", "high"]),
    assignee_id: z.null(), start_date: nullableDate, due_date: nullableDate,
    position: z.number().int().nonnegative(),
  }).strict(),
  mapping_notes: z.array(text).max(100),
}).strict();
const approval = z.object({
  source_sheet: text.min(1), source_row: z.number().int().positive(), related_task_source_id: sourceId,
  original: z.object({
    stage_gate: text.min(1), option_milestone: text.min(1), description: nullableText,
    shared_on: z.null(), client_response: z.literal("Pending"), selected: z.null(),
    signoff_date: z.null(), proof_link: nullableText, remarks: nullableText,
  }).strict(),
  mapping_note: text,
}).strict();
const note = z.object({ source_sheet: text, source_cell: text, text }).strict();

export const projectImportSchema = z.object({
  format: z.literal("spacenez.project-import-staging.v1"),
  state: z.literal("STAGING_ONLY_NOT_IMPORTED"),
  source: z.object({ filename: text.min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/i), sheets: z.array(text).min(1).max(100) }).strict(),
  target_backend_ref: z.string().min(1).max(100), target_project_id: z.null(),
  project_metadata: z.object({
    project_name: text, client_name: nullableText, site_location: nullableText,
    project_manager: nullableText, kickoff_date: nullableDate, project_name_status: text,
    client_brand: nullableText, client_email: z.string().email().nullable(),
  }).strict(),
  tasks: z.array(task).min(1).max(500),
  planned_approval_records: z.array(approval).max(500),
  workbook_workflow_notes: z.object({ classification: text, items: z.array(note).max(100) }).strict(),
  overview_material_selection_note: z.object({ source_cell: text, text, note: text }).strict(),
  summary: z.object({ tasks: z.number().int(), planned_approval_rows: z.number().int(), statuses: z.record(z.number().int()), dated_starts: z.number().int(), missing_owners: z.number().int(), missing_due_dates: z.number().int() }).strict(),
  prerequisites: z.array(text).max(100),
  defaults: z.object({ priority: text, assignee_id: text }).strict(),
  metadata_provenance: z.object({ source: text, client_brand: text, project_name: text, client_name: text, project_manager: text, kickoff_date: text, task_owners: text }).strict(),
  proposed_client_profile: z.object({ full_name: nullableText, email: z.string().email().nullable(), company: nullableText, requested_project_access: z.literal("client"), profile_id: z.null(), state: text }).strict(),
}).strict().superRefine((plan, ctx) => {
  const ids = new Set<string>();
  const coordinates = new Set<string>();
  for (const [index, row] of plan.tasks.entries()) {
    if (ids.has(row.source_id)) ctx.addIssue({ code: "custom", path: ["tasks", index, "source_id"], message: "Duplicate source task ID" });
    ids.add(row.source_id);
    if (row.source_id !== row.original.id) ctx.addIssue({ code: "custom", path: ["tasks", index], message: "Source task IDs do not match" });
    if (row.proposed_task.title !== row.original.title || row.proposed_task.description !== row.original.acceptance_criteria) ctx.addIssue({ code: "custom", path: ["tasks", index], message: "Task titles and acceptance criteria must preserve the source" });
    const coordinate = `${row.source_sheet}:${row.source_row}`;
    if (coordinates.has(coordinate)) ctx.addIssue({ code: "custom", path: ["tasks", index], message: "Duplicate source task row" });
    coordinates.add(coordinate);
    for (const field of ["start_date", "due_date"] as const) {
      const original = row.original[field];
      const proposed = row.proposed_task[field];
      if (original !== proposed && !(original !== null && !date.safeParse(original).success && proposed === null)) {
        ctx.addIssue({ code: "custom", path: ["tasks", index, "proposed_task", field], message: "Dates must preserve the source; ambiguous text must stay undated" });
      }
    }
  }
  const approvalIds = new Set<string>();
  for (const [index, row] of plan.planned_approval_records.entries()) {
    if (!ids.has(row.related_task_source_id)) ctx.addIssue({ code: "custom", path: ["planned_approval_records", index], message: "Approval refers to a missing task" });
    const coordinate = `${row.source_sheet}:${row.source_row}`;
    if (approvalIds.has(coordinate)) ctx.addIssue({ code: "custom", path: ["planned_approval_records", index], message: "Duplicate source approval row" });
    approvalIds.add(coordinate);
  }
  if (plan.summary.tasks !== plan.tasks.length || plan.summary.planned_approval_rows !== plan.planned_approval_records.length) ctx.addIssue({ code: "custom", path: ["summary"], message: "Source counts do not match the rows" });
});

export type ProjectImportPlan = z.infer<typeof projectImportSchema>;
export const importProjectFieldsSchema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(200),
  client_name: z.string().trim().max(200), client_brand: z.string().trim().max(200),
  client_email: z.union([z.literal(""), z.string().trim().email()]),
  location: z.string().trim().max(500),
  project_type: z.string().refine((value) => PROJECT_TYPES.includes(value), "Choose a project type"),
  description: z.string().max(20_000), start_date: z.union([z.literal(""), date]), target_date: z.union([z.literal(""), date]),
  meeting_url: z.string().refine((value) => { try { normalizeMeetingUrl(value); return true; } catch { return false; } }, "Use an HTTPS Calendly booking link"),
}).strict().refine((project) => !project.start_date || !project.target_date || project.target_date >= project.start_date, { path: ["target_date"], message: "Target date must be on or after the start date" });
export type ImportProjectFields = z.infer<typeof importProjectFieldsSchema>;

export function parseProjectImport(contents: string, backendRef: string, allowBackendMismatch = false): ProjectImportPlan {
  if (contents.length > 2_000_000) throw new Error("Choose an import JSON smaller than 2 MB.");
  let parsed: unknown;
  try { parsed = JSON.parse(contents); } catch { throw new Error("The selected file is not valid JSON."); }
  const result = projectImportSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    if (!issue) throw new Error("The selected file does not match the project import format.");
    throw new Error(`Invalid import at ${issue.path.join(".") || "root"}: ${issue.message}`);
  }
  if (!allowBackendMismatch && result.data.target_backend_ref !== backendRef) throw new Error("This plan targets a different backend. Review the destination before importing.");
  return result.data;
}

export function defaultImportProject(plan: ProjectImportPlan): ImportProjectFields {
  const meta = plan.project_metadata;
  return { name: meta.project_name, client_name: meta.client_name ?? "", client_brand: meta.client_brand ?? "", client_email: meta.client_email ?? "", location: meta.site_location ?? "", project_type: "Other", description: "", start_date: meta.kickoff_date ?? "", target_date: "", meeting_url: "" };
}

export function buildProjectImport(plan: ProjectImportPlan, fields: ImportProjectFields) {
  const project = importProjectFieldsSchema.parse(fields);
  const sourceNotes = [
    "Notes from project plan:",
    ...plan.workbook_workflow_notes.items.map((item) => item.text),
    plan.overview_material_selection_note.text,
  ].join("\n");
  return {
    p_project: { ...project, start_date: project.start_date || null, target_date: project.target_date || null, meeting_url: normalizeMeetingUrl(project.meeting_url), description: [project.description, sourceNotes].filter(Boolean).join("\n\n") },
    p_source_sha256: plan.source.sha256.toLowerCase(),
    p_tasks: plan.tasks.map((row) => ({
      source_id: row.source_id, title: row.proposed_task.title, description: row.proposed_task.description,
      stage: row.proposed_task.stage, status: row.proposed_task.status, priority: row.proposed_task.priority,
      start_date: row.proposed_task.start_date, due_date: row.proposed_task.due_date, position: row.proposed_task.position,
      source_metadata: { filename: plan.source.filename, sheet: row.source_sheet, row: row.source_row, original: row.original, mapping_notes: row.mapping_notes },
    })),
    p_approval_plan: plan.planned_approval_records.map((row) => ({
      source_id: `${row.source_sheet}:${row.source_row}`, task_source_id: row.related_task_source_id,
      stage_gate: row.original.stage_gate, milestone: row.original.option_milestone, description: row.original.description,
      source_metadata: { filename: plan.source.filename, sheet: row.source_sheet, row: row.source_row, original: row.original, mapping_note: row.mapping_note },
    })),
  };
}

export const projectImportResultSchema = z.object({ project_id: z.string().uuid(), created: z.boolean(), task_count: z.number().int().nonnegative(), approval_plan_count: z.number().int().nonnegative(), client_linked: z.boolean() });
export type ProjectImportResult = z.infer<typeof projectImportResultSchema>;
