import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type DailyUpdatePeriod = "today" | "week" | "all";
export type Period = DailyUpdatePeriod;
export type DailyUpdate = Database["public"]["Tables"]["project_daily_updates"]["Row"] & {
  author: { full_name: string | null; email: string | null } | null;
};

const projectCalendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
});

/** Daily site reporting uses the India calendar, independently of the viewer's device. */
export function projectDay(now = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new RangeError("A valid date is required.");
  const parts = projectCalendar.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function projectWeekStart(now = new Date()): string {
  const day = new Date(`${projectDay(now)}T00:00:00.000Z`);
  const daysSinceMonday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - daysSinceMonday);
  return day.toISOString().slice(0, 10);
}

/** Inclusive bounds for report_date, a date-only field. */
export function dailyUpdateBounds(period: DailyUpdatePeriod, now = new Date()): { from?: string; to: string } {
  const to = projectDay(now);
  return period === "today" ? { from: to, to } : period === "week" ? { from: projectWeekStart(now), to } : { to };
}

export async function loadDailyUpdates(
  projectId: string,
  { period, offset = 0, limit = 50, now = new Date() }: { period: DailyUpdatePeriod; offset?: number; limit?: number; now?: Date },
): Promise<DailyUpdate[]> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("Invalid daily-update page.");
  }
  const bounds = dailyUpdateBounds(period, now);
  let query = supabase.from("project_daily_updates")
    .select("id,project_id,report_date,work_done,next_steps,blockers,created_by,created_at,author:profiles(full_name,email)")
    .eq("project_id", projectId)
    .lte("report_date", bounds.to);
  if (bounds.from) query = query.gte("report_date", bounds.from);
  const { data, error } = await query
    .order("report_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data ?? [];
}

/** Query each project explicitly so a shared row limit cannot hide quieter projects. */
export async function loadLatestDailyUpdates(projectIds: string[]): Promise<Record<string, DailyUpdate | null>> {
  const ids = [...new Set(projectIds)];
  const latest: Record<string, DailyUpdate | null> = {};
  const now = new Date();
  for (let offset = 0; offset < ids.length; offset += 4) {
    await Promise.all(ids.slice(offset, offset + 4).map(async (id) => {
      latest[id] = (await loadDailyUpdates(id, { period: "all", limit: 1, now }))[0] ?? null;
    }));
  }
  return latest;
}
