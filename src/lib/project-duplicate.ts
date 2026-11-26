import { z } from "zod";
import { PROJECT_TYPES } from "@/lib/constants";

export const duplicateProjectFieldsSchema = z.object({
  name: z.string().trim().min(1, "Enter the new project name.").max(200),
  client_name: z.string().trim().max(200),
  client_brand: z.string().trim().max(200),
  client_email: z.union([z.literal(""), z.string().trim().email("Enter a valid client email.")]),
  location: z.string().trim().max(500),
  project_type: z.string().refine((value) => PROJECT_TYPES.includes(value), "Choose a project type."),
  description: z.string().trim().max(20_000),
}).strict();

export type DuplicateProjectFields = z.infer<typeof duplicateProjectFieldsSchema>;
export type DuplicateProjectSource = { id: string; name: string; project_type?: string };

export function defaultDuplicateProjectFields(source: DuplicateProjectSource): DuplicateProjectFields {
  return {
    name: "", client_name: "", client_brand: "", client_email: "", location: "", description: "",
    project_type: source.project_type && PROJECT_TYPES.includes(source.project_type) ? source.project_type : "Other",
  };
}

const duplicateRequestSchema = z.object({
  p_source_project_id: z.string().uuid(),
  p_request_id: z.string().uuid(),
  p_project: duplicateProjectFieldsSchema,
}).strict();
export type DuplicateProjectRequest = z.infer<typeof duplicateRequestSchema>;

export function buildDuplicateProjectRequest(sourceId: string, requestId: string, fields: DuplicateProjectFields): DuplicateProjectRequest {
  return duplicateRequestSchema.parse({ p_source_project_id: sourceId, p_request_id: requestId, p_project: fields });
}

export const duplicateProjectResultSchema = z.object({
  project_id: z.string().uuid(),
  created: z.boolean(),
  task_count: z.number().int().nonnegative(),
  approval_plan_count: z.number().int().nonnegative(),
  stage_count: z.number().int().positive(),
}).strict();
export type DuplicateProjectResult = z.infer<typeof duplicateProjectResultSchema>;

function requestStorageKey(actorId: string, sourceId: string) {
  return `spacenez-duplicate-v1:${actorId}:${sourceId}`;
}

/** An unfinished request stays tied to the same account and source in this tab. */
export function readPendingDuplicate(actorId: string, sourceId: string): DuplicateProjectRequest | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(requestStorageKey(actorId, sourceId));
    if (!raw || raw.length > 30_000) return null;
    const parsed = duplicateRequestSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.p_source_project_id === sourceId ? parsed.data : null;
  } catch { return null; }
}

export function keepPendingDuplicate(actorId: string, request: DuplicateProjectRequest) {
  try { window.sessionStorage.setItem(requestStorageKey(actorId, request.p_source_project_id), JSON.stringify(request)); }
  catch { /* The mounted dialog still retains the same request if storage is blocked. */ }
}

export function clearPendingDuplicate(actorId: string, sourceId: string) {
  try { window.sessionStorage.removeItem(requestStorageKey(actorId, sourceId)); }
  catch { /* Storage can be unavailable in private browsing. */ }
}
