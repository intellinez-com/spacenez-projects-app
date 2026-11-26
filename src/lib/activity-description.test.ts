import { describe, expect, it } from "vitest";
import { activityChangeDetails, activityContent, activityCounts, activityDescription } from "./activity-description";
import type { ProjectActivity } from "./project-activity";

function event(overrides: Partial<ProjectActivity> = {}): ProjectActivity {
  return { id: "activity-a", project_id: "project-a", actor_id: "editor-a", occurred_at: "2026-11-20T10:00:00Z", source_type: "tasks", source_id: "task-a", task_id: "task-a", kind: "task_updated", payload: { title: "Kitchen measurements", changes: { status: { from: "in_progress", to: "done" } } }, author: null, ...overrides };
}

describe("Automatic activity presentation", () => {
  it("uses event-time custom heading names while keeping legacy default labels", () => {
    const moved = event({ payload: { title: "Kitchen layout", changes: { stage: { from: "planning", to: "custom-stage" } }, stage_label: "Furniture planning", stage_labels: { stage: { from: "Initial brief", to: "Furniture planning" } } } });
    expect(activityDescription(moved)).toBe("moved Kitchen layout to Furniture planning");
    expect(activityChangeDetails(moved)).toEqual(["Stage: Initial brief → Furniture planning"]);
    const legacy = event({ payload: { title: "Kitchen layout", changes: { stage: { from: "planning", to: "layout_2d" } } } });
    expect(activityDescription(legacy)).toBe("moved Kitchen layout to 2D Layout");
    expect(activityChangeDetails(legacy)).toEqual(["Stage: Planning & Brief → 2D Layout"]);
  });

  it("describes heading edits as configuration rather than completed task work", () => {
    const renamed = event({ kind: "project_updated", payload: { heading_change: { type: "renamed", previous_label: "2D Layout", label: "Furniture planning" } } });
    const reordered = event({ kind: "project_updated", payload: { heading_change: { type: "reordered" } } });
    expect(activityDescription(renamed)).toBe("renamed the heading 2D Layout to Furniture planning");
    expect(activityDescription(reordered)).toBe("reordered the project headings");
    expect(activityCounts([renamed, reordered])).toMatchObject({ completedTasks: 0, statusChanges: 0 });
  });

  it("describes the recorded status transition and never presents a newly created Done task as a completion event", () => {
    const changed = event();
    const addedDone = event({ id: "new-task", task_id: "new-task", source_id: "new-task", kind: "task_created", payload: { title: "Imported task", status: "done" } });
    expect(activityDescription(changed)).toBe("marked Kitchen measurements as Completed");
    expect(activityChangeDetails(changed)).toEqual(["Status: In progress → Completed"]);
    expect(activityDescription(addedDone)).toBe("added Imported task");
    expect(activityCounts([addedDone])).toEqual({ completedTasks: 0, statusChanges: 0, filesShared: 0, comments: 0 });
    expect(activityCounts([changed, event({ id: "another-transition" }), addedDone])).toMatchObject({ completedTasks: 1, statusChanges: 2 });
  });

  it("shows task date edits and keeps raw owner UUIDs out of client text", () => {
    const changed = event({ payload: { title: "Furniture layout", changes: { due_date: { from: "2026-11-20", to: "2026-11-23" }, assignee_id: { from: "private-user-id-a", to: "private-user-id-b" } } } });
    expect(activityDescription(changed)).toBe("updated the dates for Furniture layout");
    expect(activityChangeDetails(changed)).toEqual(["Due date: 20 Nov 2026 → 23 Nov 2026", "Task owner changed"]);
    expect(activityChangeDetails(changed).join(" ")).not.toContain("private-user-id");
  });

  it("keeps client comments and approval feedback distinct from task work", () => {
    const comment = event({ kind: "comment_added", payload: { body: "Please confirm the dates." } });
    const approval = event({ kind: "approval_changes_requested", payload: { task_title: "Kitchen layout", feedback: "Move the sink." } });
    expect(activityDescription(comment)).toBe("left a project comment");
    expect(activityContent(comment)).toEqual([{ label: "Comment", body: "Please confirm the dates." }]);
    expect(activityDescription(approval)).toBe("requested changes to Kitchen layout");
    expect(activityContent(approval)).toEqual([{ label: "Feedback", body: "Move the sink." }]);
    expect(activityCounts([comment, approval])).toEqual({ completedTasks: 0, statusChanges: 0, filesShared: 0, comments: 1 });
  });
});
