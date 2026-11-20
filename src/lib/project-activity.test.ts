import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadActivityTracking, loadLatestProjectActivity, loadProjectActivity, projectActivityBounds } from "./project-activity";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
function query(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  const builder = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), lt: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue(result), single: vi.fn().mockResolvedValue(result) };
  from.mockReturnValue(builder); return builder;
}
beforeEach(() => { vi.resetAllMocks(); });

describe("automatic project activity", () => {
  it("uses India midnight instants and Monday weeks, including the UTC date boundary", () => {
    expect(projectActivityBounds("today", new Date("2026-11-19T18:29:59Z"))).toEqual({ from: "2026-11-18T18:30:00.000Z", to: "2026-11-19T18:30:00.000Z" });
    expect(projectActivityBounds("today", new Date("2026-11-19T18:30:00Z"))).toEqual({ from: "2026-11-19T18:30:00.000Z", to: "2026-11-20T18:30:00.000Z" });
    expect(projectActivityBounds("week", new Date("2026-11-22T18:30:00Z"))).toEqual({ from: "2026-11-22T18:30:00.000Z", to: "2026-11-23T18:30:00.000Z" });
    expect(projectActivityBounds("all", new Date("2026-11-19T18:30:00Z"))).toEqual({ to: "2026-11-20T18:30:00.000Z" });
  });
  it("scopes timestamp filtering and deterministic pagination to one project", async () => {
    const builder = query();
    await loadProjectActivity("project-a", { period: "today", offset: 50, limit: 50, now: new Date("2026-11-20T10:00:00Z") });
    expect(from).toHaveBeenCalledWith("project_activity");
    expect(builder.eq).toHaveBeenCalledWith("project_id", "project-a");
    expect(builder.gte).toHaveBeenCalledWith("occurred_at", "2026-11-19T18:30:00.000Z");
    expect(builder.lt).toHaveBeenCalledWith("occurred_at", "2026-11-20T18:30:00.000Z");
    expect(builder.order.mock.calls).toEqual([["occurred_at", { ascending: false }], ["id", { ascending: false }]]);
    expect(builder.range).toHaveBeenCalledWith(50, 99);
  });
  it("propagates read failures instead of reporting no changes and validates pages", async () => {
    const builder = query({ data: null, error: new Error("Unavailable") });
    await expect(loadProjectActivity("project-a", { period: "all" })).rejects.toThrow("Unavailable");
    expect(builder.gte).not.toHaveBeenCalled();
    await expect(loadProjectActivity("project-a", { period: "today", offset: -1 })).rejects.toThrow(RangeError);
    await expect(loadProjectActivity("project-a", { period: "today", limit: 101 })).rejects.toThrow(RangeError);
    expect(from).toHaveBeenCalledOnce();
  });
  it("fetches latest activity per distinct project without dropping quieter projects", async () => {
    const ids: string[] = [];
    const first = { id: "activity-a", project_id: "project-a" };
    from.mockImplementation(() => {
      let id = "";
      const builder = { select: vi.fn().mockReturnThis(), lt: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), eq: vi.fn((_field: string, value: string) => { id = value; ids.push(value); return builder; }), range: vi.fn(async (start: number, end: number) => { expect([start, end]).toEqual([0, 0]); return { data: id === "project-a" ? [first] : [], error: null }; }) };
      return builder;
    });
    expect(await loadLatestProjectActivity(["project-a", "project-b", "project-a"])).toEqual({ "project-a": first, "project-b": null });
    expect(ids).toEqual(["project-a", "project-b"]);
  });
  it("loads the known tracking start and does not query without projects", async () => {
    expect(await loadLatestProjectActivity([])).toEqual({});
    const builder = query({ data: { started_at: "2026-11-20T10:00:00Z" }, error: null });
    expect(await loadActivityTracking()).toEqual({ started_at: "2026-11-20T10:00:00Z" });
    expect(builder.eq).toHaveBeenCalledWith("id", true);
    expect(from).toHaveBeenCalledWith("project_activity_tracking");
  });
});
