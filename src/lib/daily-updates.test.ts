import { beforeEach, describe, expect, it, vi } from "vitest";
import { dailyUpdateBounds, loadDailyUpdates, loadLatestDailyUpdates, projectDay, projectWeekStart } from "./daily-updates";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

function query(result: { data: unknown[] | null; error: unknown } = { data: [], error: null }) {
  const builder = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), lte: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue(result),
  };
  from.mockReturnValue(builder);
  return builder;
}
beforeEach(() => { vi.resetAllMocks(); });

describe("India project reporting calendar", () => {
  it("changes day at midnight in India, independently of UTC day", () => {
    expect(projectDay(new Date("2026-11-19T18:29:59.999Z"))).toBe("2026-11-19");
    expect(projectDay(new Date("2026-11-19T18:30:00.000Z"))).toBe("2026-11-20");
  });

  it("starts this week on Monday in India across month and year boundaries", () => {
    expect(projectWeekStart(new Date("2026-11-22T18:29:59Z"))).toBe("2026-11-16");
    expect(projectWeekStart(new Date("2026-11-22T18:30:00Z"))).toBe("2026-11-23");
    expect(projectWeekStart(new Date("2027-01-01T00:00:00Z"))).toBe("2026-12-28");
  });

  it("bounds today and week inclusively and never includes future work dates", () => {
    const now = new Date("2026-11-19T18:30:00Z");
    expect(dailyUpdateBounds("today", now)).toEqual({ from: "2026-11-20", to: "2026-11-20" });
    expect(dailyUpdateBounds("week", now)).toEqual({ from: "2026-11-16", to: "2026-11-20" });
    expect(dailyUpdateBounds("all", now)).toEqual({ to: "2026-11-20" });
    expect(() => projectDay(new Date("invalid"))).toThrow(RangeError);
  });
});

describe("project-scoped daily update loading", () => {
  it("loads the selected project and reporting period with deterministic pagination", async () => {
    const builder = query();
    await loadDailyUpdates("project-a", { period: "week", offset: 50, limit: 50, now: new Date("2026-11-20T10:00:00Z") });
    expect(from).toHaveBeenCalledWith("project_daily_updates");
    expect(builder.select).toHaveBeenCalledWith(expect.stringContaining("author:profiles(full_name,email)"));
    expect(builder.eq).toHaveBeenCalledWith("project_id", "project-a");
    expect(builder.gte).toHaveBeenCalledWith("report_date", "2026-11-16");
    expect(builder.lte).toHaveBeenCalledWith("report_date", "2026-11-20");
    expect(builder.order.mock.calls).toEqual([
      ["report_date", { ascending: false }], ["created_at", { ascending: false }], ["id", { ascending: false }],
    ]);
    expect(builder.range).toHaveBeenCalledWith(50, 99);
  });

  it("keeps older reports available in So far and propagates errors instead of showing empty status", async () => {
    const builder = query({ data: null, error: new Error("Unavailable") });
    await expect(loadDailyUpdates("project-a", { period: "all", limit: 1 })).rejects.toThrow("Unavailable");
    expect(builder.gte).not.toHaveBeenCalled();
    expect(builder.range).toHaveBeenCalledWith(0, 0);
  });

  it("fetches one latest report per distinct project, preserving projects with no reports", async () => {
    const ids: string[] = [];
    const first = { id: "daily-a", project_id: "project-a" };
    from.mockImplementation(() => {
      let projectId = "";
      const builder = {
        select: vi.fn().mockReturnThis(), lte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
        eq: vi.fn((_field: string, value: string) => { projectId = value; ids.push(value); return builder; }),
        range: vi.fn(async (start: number, end: number) => {
          expect([start, end]).toEqual([0, 0]);
          return { data: projectId === "project-a" ? [first] : [], error: null };
        }),
      };
      return builder;
    });
    expect(await loadLatestDailyUpdates(["project-a", "project-b", "project-a"])).toEqual({ "project-a": first, "project-b": null });
    expect(ids).toEqual(["project-a", "project-b"]);
  });

  it("does not query without projects, and rejects invalid pages before a request", async () => {
    expect(await loadLatestDailyUpdates([])).toEqual({});
    await expect(loadDailyUpdates("project-a", { period: "today", offset: -1 })).rejects.toThrow(RangeError);
    await expect(loadDailyUpdates("project-a", { period: "today", limit: 101 })).rejects.toThrow(RangeError);
    expect(from).not.toHaveBeenCalled();
  });
});
