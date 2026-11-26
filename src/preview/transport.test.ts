// @vitest-environment node
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { previewFetch, previewIds, supabase } from "./client";
import type { Json } from "@/integrations/supabase/types";

const realFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Preview must not use real fetch"); });
afterAll(() => realFetch.mockRestore());
afterEach(() => { vi.doUnmock("@/preview/role"); vi.doUnmock("@/preview/fixtures"); vi.resetModules(); });

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

async function clientWithExtraAdmin(assigned = false) {
  vi.resetModules();
  vi.doMock("@/preview/role", () => ({ localPreviewRole: () => "client" }));
  vi.doMock("@/preview/fixtures", async (original) => {
    const actual = await original<typeof import("./fixtures")>();
    return { ...actual, createPreviewFixtures: (role: "client" | "admin") => {
      const fixture = actual.createPreviewFixtures(role);
      fixture.profiles.push({ id: previewIds.admin, full_name: " ", email: "sample-admin@example.test", company: null, created_at: fixture.profiles[0]!.created_at });
      fixture.user_roles.push({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", user_id: previewIds.admin, role: "admin" });
      if (assigned) fixture.tasks[0]!.assignee_id = previewIds.admin;
      return fixture;
    } };
  });
  return import("./client");
}

describe("isolated task-owner preview", () => {
  it("includes the global admin without requiring project membership and deduplicates current owners", async () => {
    const { supabase: admin } = await adminTransport();
    const members = await admin.from("project_members").select("user_id").eq("project_id", previewIds.project);
    expect(members.data?.some((member) => member.user_id === previewIds.admin)).toBe(false);
    const owners = await admin.rpc("get_project_task_people", { p_project_id: previewIds.project });
    expect(owners.error).toBeNull();
    expect(owners.data).toEqual([
      { id: previewIds.admin, full_name: "Sample Admin", email: "admin@example.test" },
      { id: previewIds.client, full_name: "Sample Client", email: "client@example.test" },
      { id: previewIds.designer, full_name: "Sample Designer", email: "designer@example.test" },
    ]);
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("keeps an unassigned global admin out of the client response and hides emails", async () => {
    const { supabase: client } = await clientWithExtraAdmin();
    const owners = await client.rpc("get_project_task_people", { p_project_id: previewIds.project });
    expect(owners.error).toBeNull();
    expect(owners.data).toEqual([
      { id: previewIds.client, full_name: "Sample Client", email: null },
      { id: previewIds.designer, full_name: "Sample Designer", email: null },
    ]);
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("lets a client resolve an assigned admin name without exposing their email", async () => {
    const { supabase: client } = await clientWithExtraAdmin(true);
    const owners = await client.rpc("get_project_task_people", { p_project_id: previewIds.project });
    expect(owners.error).toBeNull();
    expect(owners.data).toEqual(expect.arrayContaining([{ id: previewIds.admin, full_name: "sample-admin", email: null }]));
    expect(owners.data?.filter((person) => person.id === previewIds.admin)).toHaveLength(1);
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("denies another project and forged actor parameters without contacting a backend", async () => {
    const { supabase: admin, previewFetch: fetchAdmin } = await adminTransport();
    const otherProject = await admin.rpc("get_project_task_people", { p_project_id: "99999999-9999-4999-8999-999999999999" });
    expect(otherProject.error).toBeTruthy();
    const forged = await fetchAdmin("http://127.0.0.1:4173/rest/v1/rpc/get_project_task_people", { method: "POST", body: JSON.stringify({ p_project_id: previewIds.project, p_user_id: previewIds.client }) });
    expect(forged.status).toBe(403);
    expect(realFetch).not.toHaveBeenCalled();
  });
});

const stageAction = (admin: typeof supabase, version: number, action: Json, requestId = crypto.randomUUID()) => admin.rpc("mutate_project_stages", { p_project_id: previewIds.project, p_expected_version: version, p_request_id: requestId, p_action: action });
async function stageState(admin: typeof supabase) {
  const [project, stages, tasks, activity] = await Promise.all([
    admin.from("projects").select("*").eq("id", previewIds.project).single(),
    admin.from("project_stages").select("*").eq("project_id", previewIds.project).order("position").order("key"),
    admin.from("tasks").select("*").eq("project_id", previewIds.project).order("id"),
    admin.from("project_activity").select("*").eq("project_id", previewIds.project).order("id"),
  ]);
  expect([project.error, stages.error, tasks.error, activity.error]).toEqual([null, null, null, null]);
  return { project: project.data!, stages: stages.data!, tasks: tasks.data!, activity: activity.data! };
}

describe("isolated project-heading preview", () => {
  it("manages custom headings, accepts their tasks and preserves recorded labels through rename and explicit archive moves", async () => {
    const { supabase: admin } = await adminTransport();
    const original = await stageState(admin);
    expect(original.stages).toHaveLength(11);
    expect(original.project.stage_revision).toBe(0);
    const key = `custom_${"1".repeat(32)}`;
    const added = await stageAction(admin, 0, { type: "add", key, label: "Installation" });
    expect(added.error).toBeNull(); expect(added.data).toEqual({ version: 1, stage_key: key });
    const task = await admin.from("tasks").insert({ project_id: previewIds.project, created_by: previewIds.admin, stage: key, title: "Fit sample counter" }).select("*").single();
    expect(task.error).toBeNull(); expect(task.data?.stage).toBe(key);
    const taskId = task.data!.id;
    const createdEvent = (await stageState(admin)).activity.find((event) => event.task_id === taskId && event.kind === "task_created")!;
    expect(createdEvent.payload).toMatchObject({ stage: key, stage_label: "Installation" });
    expect((await stageAction(admin, 1, { type: "rename", key, label: "Counter installation" })).data).toEqual({ version: 2, stage_key: key });
    const selected = await admin.from("projects").update({ current_stage: key }).eq("id", previewIds.project).select("id").single();
    expect(selected.error).toBeNull();
    const renamed = await stageState(admin);
    expect(renamed.tasks.find((entry) => entry.id === taskId)?.content_revision).toBe(1);
    expect(renamed.activity.find((event) => event.id === createdEvent.id)).toEqual(createdEvent);
    const reversedKeys = renamed.stages.filter((stage) => stage.archived_at === null).map((stage) => stage.key).reverse();
    expect((await stageAction(admin, 2, { type: "reorder", keys: reversedKeys })).data).toEqual({ version: 3 });
    const reordered = await stageState(admin);
    expect(reordered.stages.filter((stage) => stage.archived_at === null).map((stage) => stage.key)).toEqual(reversedKeys);
    const archived = await stageAction(admin, 3, { type: "archive", key, move_to: "layout_2d" });
    expect(archived.error).toBeNull(); expect(archived.data).toEqual({ version: 4, stage_key: key });
    const final = await stageState(admin);
    expect(final.project).toMatchObject({ current_stage: "layout_2d", stage_revision: 4 });
    expect(final.tasks.find((entry) => entry.id === taskId)).toMatchObject({ stage: "layout_2d", content_revision: 2 });
    expect(final.stages.find((stage) => stage.key === key)).toMatchObject({ label: "Counter installation", archived_at: expect.any(String) });
    expect(final.activity.find((event) => event.task_id === taskId && event.kind === "task_updated")?.payload).toMatchObject({ stage_label: "2D Layout", stage_labels: { stage: { from: "Counter installation", to: "2D Layout" } } });
    expect(final.activity.map((event) => event.payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({ heading_change: { type: "added", key, label: "Installation" } }),
      expect.objectContaining({ heading_change: { type: "renamed", key, label: "Counter installation", previous_label: "Installation" } }),
      expect.objectContaining({ heading_change: { type: "reordered", order: expect.any(Array) } }),
      expect.objectContaining({ heading_change: { type: "removed", key, label: "Counter installation", moved_tasks: 1, move_to: "layout_2d", move_to_label: "2D Layout" } }),
      expect.objectContaining({ stage_labels: { current_stage: { from: "Counter installation", to: "2D Layout" } } }),
    ]));
    for (const event of original.activity) expect(final.activity.find((entry) => entry.id === event.id)).toEqual(event);
    expect(final.activity.find((event) => event.id === createdEvent.id)).toEqual(createdEvent);
    expect((await admin.from("tasks").insert({ project_id: previewIds.project, created_by: previewIds.admin, stage: key, title: "Archived task" })).error).toBeTruthy();
    expect((await admin.from("projects").update({ current_stage: key }).eq("id", previewIds.project)).error).toBeTruthy();
    expect((await admin.from("projects").update({ stage_revision: 99 }).eq("id", previewIds.project)).error).toBeTruthy();
    expect(await stageState(admin)).toEqual(final);
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("replays the exact saved request before version checks and rejects request reuse or stale writes without side effects", async () => {
    const { supabase: admin } = await adminTransport();
    const requestId = crypto.randomUUID();
    const first = await stageAction(admin, 0, { type: "add", label: "Finishing" }, requestId);
    expect(first.error).toBeNull();
    const key = (first.data as { stage_key: string }).stage_key;
    expect(key).toMatch(/^custom_[0-9a-f]{32}$/);
    expect((await stageAction(admin, 0, { label: "Finishing", type: "add" }, requestId)).data).toEqual(first.data);
    expect((await stageAction(admin, 1, { type: "rename", key, label: "Final finishing" })).error).toBeNull();
    const saved = await stageState(admin);
    expect(saved.project.stage_revision).toBe(2);
    expect((await stageAction(admin, 0, { type: "add", label: "Finishing" }, requestId)).data).toEqual(first.data);
    expect((await stageAction(admin, 0, { type: "add", label: "Different finishing" }, requestId)).error?.code).toBe("23505");
    expect((await stageAction(admin, 0, { type: "rename", key, label: "Stale name" })).error?.code).toBe("40001");
    expect(await stageState(admin)).toEqual(saved);
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("validates the whole heading action before changing any task, project or history", async () => {
    const { supabase: admin } = await adminTransport();
    const initial = await stageState(admin);
    const badActions: Json[] = [
      [], { type: "add", label: " \t\n" },
      { type: "archive", key: "layout_2d" }, { type: "archive", key: "layout_2d", move_to: "layout_2d" },
      { type: "rename", key: "planning", label: "Site Survey" }, { type: "add", label: "Site Survey" },
      { type: "add", label: "Invalid identity", key: "custom_not-a-key" }, { type: "add", label: "x".repeat(121) },
      { type: "reorder", keys: initial.stages.map((stage) => stage.key).slice(1) },
      { type: "reorder", keys: initial.stages.map((stage) => stage.key) },
      { type: "rename", key: "planning", label: "Uncommitted", unexpected: true },
    ];
    for (const action of badActions) {
      expect((await stageAction(admin, 0, action)).error).toBeTruthy();
      expect(await stageState(admin)).toEqual(initial);
    }
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("requires admin access, denies direct catalogue writes and keeps at least one active heading", async () => {
    expect((await stageAction(supabase, 0, { type: "add", label: "Client heading" })).error?.code).toBe("42501");
    expect((await supabase.from("project_stages").update({ label: "Client rewrite" }).eq("project_id", previewIds.project)).error).toBeTruthy();
    const { supabase: admin } = await adminTransport();
    const initial = await stageState(admin);
    expect((await admin.rpc("mutate_project_stages", { p_project_id: "99999999-9999-4999-8999-999999999999", p_expected_version: 0, p_request_id: crypto.randomUUID(), p_action: { type: "add", label: "Foreign heading" } })).error?.code).toBe("42501");
    let version = 0;
    for (const heading of initial.stages.filter((stage) => stage.key !== "layout_2d")) {
      const response = await stageAction(admin, version, { type: "archive", key: heading.key, move_to: "layout_2d" });
      expect(response.error).toBeNull(); version += 1;
    }
    const saved = await stageState(admin);
    expect(saved.stages.filter((stage) => stage.archived_at === null)).toHaveLength(1);
    expect((await stageAction(admin, version, { type: "archive", key: "layout_2d", move_to: "planning" })).error?.message).toContain("Keep at least one");
    expect(await stageState(admin)).toEqual(saved);
    expect((await admin.from("project_stages").update({ label: "Raw admin rewrite" }).eq("project_id", previewIds.project)).error).toBeTruthy();
    expect(realFetch).not.toHaveBeenCalled();
  });
});

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

describe("isolated project-duplication preview", () => {
  it("duplicates active headings and tasks with fresh progress and allows full edits and deletes on the copy without touching the source", async () => {
    const { supabase: admin } = await adminTransport();
    const addedHeading = await stageAction(admin, 0, { type: "add", label: "Kitchen installation" });
    expect(addedHeading.error).toBeNull();
    const customKey = (addedHeading.data as { stage_key: string }).stage_key;
    expect((await stageAction(admin, 1, { type: "archive", key: "mood_boards" })).error).toBeNull();

    const requestId = crypto.randomUUID();
    const duplicated = await admin.rpc("duplicate_project", {
      p_source_project_id: previewIds.project,
      p_request_id: requestId,
      p_project: { name: "Copied Studio Villa", client_name: "New Client", client_brand: "", client_email: "new@example.test", location: "Chandigarh", project_type: "Villa", description: "Fresh copy notes" },
    });
    expect(duplicated.error).toBeNull();
    const result = duplicated.data as { project_id: string; created: boolean; task_count: number; approval_plan_count: number; stage_count: number };
    expect(result).toMatchObject({ created: true, task_count: 8, approval_plan_count: 1, stage_count: 11 });
    expect(result.project_id).not.toBe(previewIds.project);

    const retry = await admin.rpc("duplicate_project", {
      p_source_project_id: previewIds.project,
      p_request_id: requestId,
      p_project: { name: "Copied Studio Villa", client_name: "New Client", client_brand: "", client_email: "new@example.test", location: "Chandigarh", project_type: "Villa", description: "Fresh copy notes" },
    });
    expect(retry.error).toBeNull();
    expect(retry.data).toEqual({ ...result, created: false });
    expect((await admin.rpc("duplicate_project", {
      p_source_project_id: previewIds.project,
      p_request_id: requestId,
      p_project: { name: "Different Name", client_name: "", client_brand: "", client_email: "", location: "", project_type: "Villa", description: "" },
    })).error?.code).toBe("23505");

    const copiedStages = await admin.from("project_stages").select("*").eq("project_id", result.project_id).order("position");
    expect(copiedStages.data?.some((stage) => stage.key === customKey && stage.label === "Kitchen installation")).toBe(true);
    expect(copiedStages.data?.some((stage) => stage.key === "mood_boards")).toBe(false);

    const copiedTasks = await admin.from("tasks").select("*").eq("project_id", result.project_id).order("position");
    expect(copiedTasks.data).toHaveLength(8);
    expect(copiedTasks.data?.every((task) => task.status === "not_started" && task.assignee_id === null && task.start_date === null && task.due_date === null)).toBe(true);
    expect((await admin.from("project_members").select("*").eq("project_id", result.project_id)).data).toEqual([]);
    expect((await admin.from("comments").select("*").eq("project_id", result.project_id)).data).toEqual([]);
    expect((await admin.from("documents").select("*").eq("project_id", result.project_id)).data).toEqual([]);
    expect((await admin.from("task_approvals").select("*").eq("project_id", result.project_id)).data).toEqual([]);
    expect((await admin.from("task_approval_plan").select("*").eq("project_id", result.project_id)).data).toHaveLength(1);
    expect((await admin.rpc("get_project_task_people", { p_project_id: result.project_id })).data).toEqual([
      { id: previewIds.admin, full_name: "Sample Admin", email: "admin@example.test" },
    ]);

    // Add, edit, delete tasks, mutate headings and edit details in the new copy independently of the source.
    const addedTask = await admin.from("tasks").insert({ project_id: result.project_id, created_by: previewIds.admin, stage: customKey, title: "Install custom island" }).select("*").single();
    expect(addedTask.error).toBeNull();
    const updatedTask = await admin.from("tasks").update({ assignee_id: previewIds.admin, status: "in_progress" }).eq("project_id", result.project_id).eq("id", addedTask.data!.id).select("*").single();
    expect(updatedTask.data).toMatchObject({ assignee_id: previewIds.admin, status: "in_progress" });
    const deletedTask = await admin.from("tasks").delete().eq("project_id", result.project_id).eq("id", addedTask.data!.id).select("id").single();
    expect(deletedTask.error).toBeNull();
    expect((await admin.from("tasks").select("*").eq("project_id", result.project_id)).data).toHaveLength(8);
    expect((await admin.rpc("mutate_project_stages", { p_project_id: result.project_id, p_expected_version: 0, p_request_id: crypto.randomUUID(), p_action: { type: "rename", key: customKey, label: "Custom joinery" } })).error).toBeNull();
    const updatedProject = await admin.from("projects").update({ location: "Mohali" }).eq("id", result.project_id).eq("location", "Chandigarh").select("*").single();
    expect(updatedProject.data?.location).toBe("Mohali");

    // Original source project remains untouched and approval-linked source tasks cannot be deleted.
    expect((await admin.from("projects").select("location").eq("id", previewIds.project).single()).data?.location).toBe("Sample site");
    expect((await admin.from("tasks").delete().eq("project_id", previewIds.project).eq("id", previewIds.reviewTask).select("id").single()).error).toBeTruthy();
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("denies duplication and task deletion in client preview", async () => {
    const dup = await supabase.rpc("duplicate_project", {
      p_source_project_id: previewIds.project,
      p_request_id: crypto.randomUUID(),
      p_project: { name: "Forbidden", client_name: "", client_brand: "", client_email: "", location: "", project_type: "Other", description: "" },
    });
    expect(dup.error?.code).toBe("42501");
    expect((await supabase.from("tasks").delete().eq("project_id", previewIds.project).eq("id", previewIds.reviewTask)).error).toBeTruthy();
    expect(realFetch).not.toHaveBeenCalled();
  });
});
