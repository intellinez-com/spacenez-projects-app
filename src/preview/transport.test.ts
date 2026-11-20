// @vitest-environment node
import { afterAll, describe, expect, it, vi } from "vitest";
import { previewFetch, previewIds, supabase } from "./client";

const realFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Preview must not use real fetch"); });
afterAll(() => realFetch.mockRestore());

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
});
