// @vitest-environment node
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { previewFetch, previewIds, supabase } from "./client";

const realFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Preview must not use real fetch"); });
afterAll(() => realFetch.mockRestore());
afterEach(() => { vi.doUnmock("@/preview/role"); vi.resetModules(); });

describe("isolated client preview transport", () => {
  it("loads the sample client and their project membership using the actual SDK", async () => {
    const auth = await supabase.auth.getUser();
    expect(auth.error).toBeNull();
    expect(auth.data.user?.id).toBe(previewIds.client);
    const membership = await supabase.from("project_members").select("*,profile:profiles(*)").eq("user_id", previewIds.client);
    expect(membership.error).toBeNull();
    expect(membership.data).toHaveLength(1);
    expect(membership.data?.[0]?.access).toBe("client");
  });

  it("posts a comment locally and returns author and task context", async () => {
    const inserted = await supabase.from("comments").insert({ project_id: previewIds.project, task_id: previewIds.reviewTask, user_id: previewIds.client, body: "A local preview comment" });
    expect(inserted.error).toBeNull();
    const loaded = await supabase.from("comments").select("*,author:profiles(full_name),task:tasks!comments_task_project_fkey(title)").eq("project_id", previewIds.project).eq("task_id", previewIds.reviewTask).order("created_at", { ascending: false }).range(0, 4);
    expect(loaded.error).toBeNull();
    expect(loaded.data?.[0]?.body).toBe("A local preview comment");
    expect(loaded.data?.[0]?.author?.full_name).toBe("Sample Client");
    const activity = await supabase.from("project_activity").select("*,author:profiles(full_name)").eq("project_id", previewIds.project).eq("source_id", loaded.data![0]!.id);
    expect(activity.error).toBeNull();
    expect(activity.data?.[0]?.kind).toBe("comment_added");
    expect(activity.data?.[0]?.actor_id).toBe(previewIds.client);
  });

  it("loads dated team reports separately from comments and keeps reports read-only for clients", async () => {
    const all = await supabase.from("project_daily_updates").select("*,author:profiles(full_name,email)").eq("project_id", previewIds.project).order("report_date", { ascending: false }).range(0, 49);
    expect(all.error).toBeNull();
    expect(all.data).toHaveLength(3);
    const today = all.data![0]!.report_date;
    const dated = await supabase.from("project_daily_updates").select("*,author:profiles(full_name,email)").eq("project_id", previewIds.project).gte("report_date", today).lte("report_date", today);
    expect(dated.error).toBeNull();
    expect(dated.data).toHaveLength(1);
    expect(dated.data?.[0]?.author?.full_name).toBe("Sample Designer");
    const forbidden = await supabase.from("project_daily_updates").insert({ project_id: previewIds.project, work_done: "A client cannot publish a team report" });
    expect(forbidden.error).toBeTruthy();
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("reads recorded activity through the SDK while denying fabricated events", async () => {
    const activity = await supabase.from("project_activity").select("*,author:profiles(full_name,email)").eq("project_id", previewIds.project).eq("kind", "task_updated").order("occurred_at", { ascending: false }).range(0, 49);
    expect(activity.error).toBeNull();
    expect(activity.data).toHaveLength(2);
    expect(activity.data?.[0]?.author?.full_name).toBe("Sample Designer");
    const forged = await supabase.from("project_activity").insert({ project_id: previewIds.project, kind: "task_updated", source_type: "tasks", source_id: previewIds.reviewTask, payload: { status: "done" } });
    expect(forged.error).toBeTruthy();
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("requires change feedback and records a decision without a real backend", async () => {
    const pending = await supabase.from("task_approvals").select("*").eq("task_id", previewIds.reviewTask).single();
    expect(pending.error).toBeNull();
    if (!pending.data) throw new Error("Missing sample approval");
    const blank = await supabase.rpc("respond_task_approval", { p_approval_id: pending.data.id, p_decision: "changes_requested", p_feedback: " " });
    expect(blank.error).toBeTruthy();
    const decided = await supabase.rpc("respond_task_approval", { p_approval_id: pending.data.id, p_decision: "approved", p_feedback: "Sample approval" });
    expect(decided.error).toBeNull();
    const saved = await supabase.from("task_approvals").select("*").eq("id", pending.data.id).single();
    expect(saved.data?.state).toBe("approved");
    expect(saved.data?.decided_by).toBe(previewIds.client);
  });

  it("opens only local sample files and denies editor actions and external requests", async () => {
    const signed = await supabase.storage.from("project-files").createSignedUrl(`${previewIds.project}/sample-room.png`, 300);
    expect(signed.error).toBeNull();
    expect(signed.data?.signedUrl).toBe(`http://127.0.0.1:4173/storage/v1/object/sign/project-files/${previewIds.project}/sample-room.png?token=local-preview`);
    const forbidden = await supabase.from("tasks").update({ title: "Should be denied" }).eq("id", previewIds.reviewTask);
    expect(forbidden.error).toBeTruthy();
    const external = await previewFetch("https://example.invalid/rest/v1/projects");
    expect(external.status).toBe(403);
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("keeps client task creation, scoped edits and history rewrites denied", async () => {
    const added = await supabase.from("tasks").insert({ project_id: previewIds.project, created_by: previewIds.client, stage: "planning", title: "Forbidden client task" }).select("*").single();
    expect(added.error).toBeTruthy();
    const changed = await supabase.from("tasks").update({ status: "done" }).eq("project_id", previewIds.project).eq("id", previewIds.reviewTask).select("*").single();
    expect(changed.error).toBeTruthy();
    const rewritten = await supabase.from("project_activity").update({ payload: { status: "done" } }).eq("project_id", previewIds.project);
    expect(rewritten.error).toBeTruthy();
    expect(realFetch).not.toHaveBeenCalled();
  });
});

async function adminTransport() {
  vi.resetModules();
  vi.doMock("@/preview/role", () => ({ localPreviewRole: () => "admin" }));
  return import("./client");
}

describe("isolated task-sheet admin preview", () => {
  it("adds a task through the SDK with real defaults and automatically records a fictional create event", async () => {
    const { supabase: admin } = await adminTransport();
    const added = await admin.from("tasks").insert({ project_id: previewIds.project, created_by: previewIds.admin, stage: "procurement", title: "  Order sample fixtures  ", position: 8 }).select("id").single();
    expect(added.error).toBeNull();
    expect(added.data?.id).toBeTruthy();
    const task = await admin.from("tasks").select("*").eq("project_id", previewIds.project).eq("id", added.data!.id).single();
    expect(task.data).toMatchObject({ title: "Order sample fixtures", stage: "procurement", status: "not_started", assignee_id: null, start_date: null, due_date: null, priority: "medium", position: 8, created_by: previewIds.admin });
    const history = await admin.from("project_activity").select("*").eq("project_id", previewIds.project).eq("task_id", added.data!.id);
    expect(history.data).toHaveLength(1);
    expect(history.data?.[0]).toMatchObject({ kind: "task_created", actor_id: previewIds.admin, task_id: added.data!.id, payload: { title: "Order sample fixtures", status: "not_started", stage: "procurement" } });
    const list = await admin.from("tasks").insert({ project_id: previewIds.project, created_by: previewIds.admin, stage: "planning", title: "Array response" }).select("*");
    expect(list.error).toBeNull();
    expect(Array.isArray(list.data)).toBe(true);
    expect(list.data?.[0]?.title).toBe("Array response");
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("saves row fields, records only actual changes and rejects invalid or unscoped edits without changing data", async () => {
    const { supabase: admin } = await adminTransport();
    const original = await admin.from("tasks").select("*").eq("id", previewIds.reviewTask).single();
    expect(original.error).toBeNull();
    const due = new Date(`${original.data!.due_date ?? "2040-01-01"}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + 7);
    const update = { title: "Revised sample layout", status: "done", priority: "high", assignee_id: previewIds.admin, start_date: "2026-11-25", due_date: due.toISOString().slice(0, 10) };
    const saved = await admin.from("tasks").update(update).eq("project_id", previewIds.project).eq("id", previewIds.reviewTask).select("*").single();
    expect(saved.error).toBeNull();
    expect(saved.data).toMatchObject({ ...update, content_revision: 2 });
    const events = () => admin.from("project_activity").select("*").eq("project_id", previewIds.project).eq("task_id", previewIds.reviewTask).eq("kind", "task_updated");
    expect((await events()).data).toMatchObject([{ actor_id: previewIds.admin, payload: { changes: { title: { from: "Review the furniture layout", to: update.title }, status: { from: "review", to: "done" }, due_date: { from: original.data!.due_date, to: update.due_date } } } }]);
    await admin.from("tasks").update(update).eq("project_id", previewIds.project).eq("id", previewIds.reviewTask).select("*").single();
    expect((await events()).data).toHaveLength(1);
    const invalid = await admin.from("tasks").update({ title: "Do not partially save", due_date: "2026-02-30" }).eq("project_id", previewIds.project).eq("id", previewIds.reviewTask).select("*").single();
    expect(invalid.error).toBeTruthy();
    const unscoped = await admin.from("tasks").update({ status: "blocked" }).eq("id", previewIds.reviewTask).select("*").single();
    expect(unscoped.error).toBeTruthy();
    const wrongProject = await admin.from("tasks").update({ status: "blocked" }).eq("project_id", "another-project").eq("id", previewIds.reviewTask).select("*").single();
    expect(wrongProject.error).toBeTruthy();
    expect((await admin.from("tasks").select("*").eq("id", previewIds.reviewTask).single()).data).toEqual(saved.data);
    expect((await events()).data).toHaveLength(1);
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("lets admins comment as themselves and denies impersonation, fabricated history and external requests", async () => {
    const { supabase: admin, previewFetch: adminFetch } = await adminTransport();
    const comment = await admin.from("comments").insert({ project_id: previewIds.project, task_id: previewIds.reviewTask, user_id: previewIds.admin, body: "A fictional admin note from the task row" });
    expect(comment.error).toBeNull();
    const notes = await admin.from("comments").select("*,author:profiles(full_name)").eq("user_id", previewIds.admin);
    expect(notes.data).toHaveLength(1);
    expect(notes.data?.[0]).toMatchObject({ body: "A fictional admin note from the task row", author: { full_name: "Sample Admin" } });
    const impersonated = await admin.from("comments").insert({ project_id: previewIds.project, task_id: previewIds.reviewTask, user_id: previewIds.client, body: "Not this admin" });
    expect(impersonated.error).toBeTruthy();
    const forged = await admin.from("project_activity").insert({ project_id: previewIds.project, kind: "task_updated", source_type: "tasks", source_id: previewIds.reviewTask, payload: { status: "done" } });
    expect(forged.error).toBeTruthy();
    expect((await adminFetch("https://example.invalid/rest/v1/tasks", { method: "POST", body: "{}" })).status).toBe(403);
    expect(realFetch).not.toHaveBeenCalled();
  });
});
