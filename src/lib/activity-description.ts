import { format, isValid, parseISO } from "date-fns";
import { stageLabel } from "@/lib/constants";
import type { ProjectActivity } from "@/lib/project-activity";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function activityPayload(activity: ProjectActivity) { return record(activity.payload); }

function text(value: unknown, fallback = "") { return typeof value === "string" && value.trim() ? value : fallback; }

export function activityStatus(value: unknown, project = false) {
  const status = text(value);
  const labels: Record<string, string> = project
    ? { active: "Active", on_hold: "On hold", completed: "Completed", archived: "Archived" }
    : { not_started: "Not started", in_progress: "In progress", review: "In review", blocked: "Blocked", done: "Completed" };
  return labels[status] || status || "Not set";
}

function date(value: unknown) {
  const raw = text(value);
  if (!raw) return "Not set";
  const parsed = parseISO(raw);
  return isValid(parsed) ? format(parsed, "d MMM yyyy") : "Date unavailable";
}

/** A plain action, without the actor's name, shared by the home preview and timeline. */
export function activityDescription(activity: ProjectActivity): string {
  const payload = activityPayload(activity);
  const changes = record(payload["changes"]);
  const title = text(payload["title"], "a task");
  const file = text(payload["name"], "a file");
  const approvalTask = text(payload["task_title"], "a task");
  if (activity.kind === "task_created") return `added ${title}`;
  if (activity.kind === "task_deleted") return `removed ${title}`;
  if (activity.kind === "task_updated") {
    if (changes["status"]) return `marked ${title} as ${activityStatus(record(changes["status"])["to"])}`;
    if (changes["title"]) return `renamed ${text(record(changes["title"])["from"], "a task")} to ${text(record(changes["title"])["to"], title)}`;
    if (changes["due_date"] || changes["start_date"]) return `updated the dates for ${title}`;
    if (changes["stage"]) return `moved ${title} to ${stageLabel(text(record(changes["stage"])["to"], "another stage"))}`;
    if (changes["assignee_id"]) return `changed the owner of ${title}`;
    return `updated ${title}`;
  }
  if (activity.kind === "project_updated") {
    if (changes["current_stage"]) return `moved the project to ${stageLabel(text(record(changes["current_stage"])["to"], "another stage"))}`;
    if (changes["status"]) return `changed the project status to ${activityStatus(record(changes["status"])["to"], true)}`;
    if (changes["start_date"] || changes["target_date"]) return "updated the project dates";
    return "updated the project details";
  }
  if (activity.kind === "document_added") return `shared ${file}`;
  if (activity.kind === "document_updated") return `updated ${file}`;
  if (activity.kind === "document_removed") return `removed ${file}`;
  if (activity.kind === "comment_added") return payload["task_title"] ? `commented on ${text(payload["task_title"], "a task")}` : "left a project comment";
  if (activity.kind === "approval_requested") return `requested approval for ${approvalTask}`;
  if (activity.kind === "approval_approved") return `approved ${approvalTask}`;
  if (activity.kind === "approval_changes_requested") return `requested changes to ${approvalTask}`;
  if (activity.kind === "team_note") return "shared a project note";
  return "recorded a project update";
}

/** Before/after values use names and dates; internal account IDs stay out of the client view. */
export function activityChangeDetails(activity: ProjectActivity): string[] {
  const changes = record(activityPayload(activity)["changes"]);
  const project = activity.kind === "project_updated";
  const output: string[] = [];
  for (const [key, value] of Object.entries(changes)) {
    const change = record(value);
    const from = change["from"], to = change["to"];
    if (key === "status") output.push(`Status: ${activityStatus(from, project)} → ${activityStatus(to, project)}`);
    else if (key === "due_date") output.push(`Due date: ${date(from)} → ${date(to)}`);
    else if (key === "start_date") output.push(`Start date: ${date(from)} → ${date(to)}`);
    else if (key === "target_date") output.push(`Target handover: ${date(from)} → ${date(to)}`);
    else if (key === "stage" || key === "current_stage") output.push(`Stage: ${from ? stageLabel(text(from)) : "Not set"} → ${to ? stageLabel(text(to)) : "Not set"}`);
    else if (key === "title" || key === "name") output.push(`Name: ${text(from, "Not set")} → ${text(to, "Not set")}`);
    else if (key === "priority") output.push(`Priority: ${text(from, "Not set")} → ${text(to, "Not set")}`);
    else if (key === "assignee_id") output.push("Task owner changed");
    else if (key === "description") output.push("Description updated");
    else if (key === "position") output.push("Task order changed");
  }
  return output;
}

export function activityContent(activity: ProjectActivity): { label: string; body: string }[] {
  const payload = activityPayload(activity);
  if (activity.kind === "comment_added") return [{ label: "Comment", body: text(payload["body"]) }].filter((item) => item.body);
  if (activity.kind === "approval_approved" || activity.kind === "approval_changes_requested") return [{ label: "Feedback", body: text(payload["feedback"]) }].filter((item) => item.body);
  if (activity.kind === "team_note") return [
    { label: "Note", body: text(payload["work_done"]) },
    { label: "Next steps", body: text(payload["next_steps"]) },
    { label: "Delays / blockers", body: text(payload["blockers"]) },
    { label: "Work date", body: payload["report_date"] ? date(payload["report_date"]) : "" },
  ].filter((item) => item.body);
  return [];
}

export function activityCounts(activities: ProjectActivity[]) {
  const completedTasks = new Set<string>();
  let statusChanges = 0, filesShared = 0, comments = 0;
  for (const activity of activities) {
    if (activity.kind === "task_updated") {
      const change = record(record(activityPayload(activity)["changes"])["status"]);
      if ("to" in change && change["from"] !== change["to"]) {
        statusChanges++;
        if (change["to"] === "done") completedTasks.add(activity.task_id || activity.source_id);
      }
    } else if (activity.kind === "document_added") filesShared++;
    else if (activity.kind === "comment_added") comments++;
  }
  return { completedTasks: completedTasks.size, statusChanges, filesShared, comments };
}
