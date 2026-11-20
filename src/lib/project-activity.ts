import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { projectDay, projectWeekStart } from "./daily-updates";

export { projectDay, projectWeekStart } from "./daily-updates";
export type ActivityPeriod = "today" | "week" | "all";
export type ProjectActivity = Database["public"]["Tables"]["project_activity"]["Row"] & {
  author: { full_name: string | null; email: string | null } | null;
};

/** Inclusive start and exclusive end, expressed as real instants in India's calendar. */
export function projectActivityBounds(period: ActivityPeriod, now = new Date()): { from?: string; to: string } {
  const today = projectDay(now);
  const start = new Date(`${today}T00:00:00+05:30`);
  const to = new Date(start.getTime() + 86_400_000).toISOString();
  if (period === "all") return { to };
  return { from: new Date(`${period === "today" ? today : projectWeekStart(now)}T00:00:00+05:30`).toISOString(), to };
}

export async function loadProjectActivity(
  projectId: string,
  { period, offset = 0, limit = 50, now = new Date() }: { period: ActivityPeriod; offset?: number; limit?: number; now?: Date },
): Promise<ProjectActivity[]> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("Invalid project activity page.");
  }
  const bounds = projectActivityBounds(period, now);
  let query = supabase.from("project_activity")
    .select("id,project_id,actor_id,kind,occurred_at,source_type,source_id,task_id,payload,author:profiles(full_name,email)")
    .eq("project_id", projectId)
    .lt("occurred_at", bounds.to);
  if (bounds.from) query = query.gte("occurred_at", bounds.from);
  const { data, error } = await query.order("occurred_at", { ascending: false }).order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data ?? [];
}

export async function loadLatestProjectActivity(projectIds: string[]): Promise<Record<string, ProjectActivity | null>> {
  const ids = [...new Set(projectIds)];
  const latest: Record<string, ProjectActivity | null> = {};
  const now = new Date();
  for (let offset = 0; offset < ids.length; offset += 4) {
    await Promise.all(ids.slice(offset, offset + 4).map(async (id) => {
      latest[id] = (await loadProjectActivity(id, { period: "all", limit: 1, now }))[0] ?? null;
    }));
  }
  return latest;
}

export async function loadActivityTracking(): Promise<{ started_at: string }> {
  const { data, error } = await supabase.from("project_activity_tracking").select("started_at").eq("id", true).single();
  if (error) throw error;
  if (!data) throw new Error("Activity tracking information is unavailable.");
  return data;
}
