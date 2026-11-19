export const STAGES = [
  { key: "planning", label: "Planning & Brief" },
  { key: "site_survey", label: "Site Survey" },
  { key: "layout_2d", label: "2D Layout" },
  { key: "mood_boards", label: "Mood Boards" },
  { key: "design_3d", label: "3D Visualisation" },
  { key: "interior_design", label: "Interior Design & Materials" },
  { key: "drawings", label: "Working Drawings & BOQ" },
  { key: "approvals", label: "Client Approvals" },
  { key: "procurement", label: "Procurement" },
  { key: "execution", label: "Execution" },
  { key: "handover", label: "Handover" },
] as const;

export const STATUSES = [
  { key: "not_started", label: "Not started" },
  { key: "in_progress", label: "In progress" },
  { key: "review", label: "In review" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
] as const;

export const PRIORITIES = [
  { key: "low", label: "Low" },
  { key: "medium", label: "Medium" },
  { key: "high", label: "High" },
] as const;

export const PROJECT_TYPES = ["Apartment", "Villa", "Office", "Retail", "Hospitality", "Other"];

export const stageLabel = (k: string) => STAGES.find((s) => s.key === k)?.label ?? k;
export const statusLabel = (k: string) => STATUSES.find((s) => s.key === k)?.label ?? k;
export const stageIndex = (k: string) => Math.max(0, STAGES.findIndex((s) => s.key === k));

/** Percent of tasks done; 0 when no tasks. */
export function progressOf(tasks: { status: string }[]) {
  if (!tasks.length) return 0;
  return Math.round((tasks.filter((t) => t.status === "done").length / tasks.length) * 100);
}
