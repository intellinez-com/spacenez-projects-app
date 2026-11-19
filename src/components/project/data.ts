import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Task = Database["public"]["Tables"]["tasks"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Doc = Database["public"]["Tables"]["documents"]["Row"];

export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again.") {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message
    : fallback;
}

export async function loadProject(id: string) {
  const [p, t, m, d] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.from("tasks").select("*").eq("project_id", id).order("position"),
    supabase.from("project_members").select("*, profile:profiles(*)").eq("project_id", id),
    supabase.from("documents").select("*").eq("project_id", id).order("created_at", { ascending: false }),
  ]);
  for (const result of [p, t, m, d]) if (result.error) throw result.error;
  return { project: p.data, tasks: t.data ?? [], members: m.data ?? [], documents: d.data ?? [] };
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: () => loadProject(id),
  });
}

export function useTaskMutations(projectId: string) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["project", projectId] }),
    qc.invalidateQueries({ queryKey: ["projects"] }),
    qc.invalidateQueries({ queryKey: ["task-approvals", projectId] }),
  ]);
  return {
    refresh,
    async update(id: string, patch: Partial<Task>) {
      try {
        const fields = ["title", "description", "status", "stage", "priority", "assignee_id", "start_date", "due_date", "position"] as const;
        const changes = Object.fromEntries(fields.filter((field) => patch[field] !== undefined).map((field) => [field, patch[field]])) as Partial<Pick<Task, (typeof fields)[number]>>;
        if (!Object.keys(changes).length) throw new Error("No editable task fields were supplied.");
        const { data, error } = await supabase.from("tasks").update(changes).eq("id", id).eq("project_id", projectId).select("*").single();
        if (error) throw error;
        if (!data) throw new Error("This task could not be updated. Refresh and try again.");
        // Wait for the server before changing the view, including its approval revision.
        qc.setQueryData<Awaited<ReturnType<typeof loadProject>>>(["project", projectId], (old) =>
          old ? { ...old, tasks: old.tasks.map((task) => task.id === id ? data : task) } : old,
        );
        void refresh();
      } catch (error) {
        toast.error(errorMessage(error));
        throw error;
      }
    },
    async add(stage: string, title: string, position: number) {
      try {
        const { data: u, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!u.user) throw new Error("Your session has expired. Sign in again before adding a task.");
        if (!title.trim()) throw new Error("Enter a task title.");
        const { error } = await supabase.from("tasks").insert({ project_id: projectId, stage, title: title.trim(), position, created_by: u.user.id }).select("id").single();
        if (error) throw error;
        void refresh();
      } catch (error) {
        toast.error(errorMessage(error));
        throw error;
      }
    },
    async remove(id: string) {
      try {
        const { data, error } = await supabase.from("tasks").delete().eq("id", id).eq("project_id", projectId).select("id").single();
        if (error) throw error;
        if (!data) throw new Error("This task could not be deleted. Refresh and try again.");
        void refresh();
      } catch (error) {
        toast.error(errorMessage(error));
        throw error;
      }
    },
  };
}

export async function uploadDoc(projectId: string, file: File, taskId?: string | null) {
  const { data: u, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!u.user) throw new Error("Your session has expired. Sign in again before uploading a file.");
  const path = `${projectId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
  const { error } = await supabase.storage.from("project-files").upload(path, file);
  if (error) throw error;
  try {
    const { error: recordError } = await supabase
      .from("documents")
      .insert({ project_id: projectId, task_id: taskId ?? null, name: file.name, path, size: file.size, uploaded_by: u.user.id });
    if (recordError) throw recordError;
  } catch (recordError) {
    try {
      const { error: cleanupError } = await supabase.storage.from("project-files").remove([path]);
      if (cleanupError) throw cleanupError;
    } catch {
      throw new Error(`${errorMessage(recordError)} The uploaded file could not be cleaned up; contact an administrator.`);
    }
    throw recordError;
  }
}

export async function openDoc(path: string) {
  // Open synchronously from the click so browsers do not block the later async URL.
  let preview: Window | null = null;
  try {
    preview = window.open("about:blank", "_blank");
    if (!preview) { toast.error("Your browser blocked the file window. Allow pop-ups for this site and try again."); return; }
    preview.opener = null;
    const { data, error } = await supabase.storage.from("project-files").createSignedUrl(path, 300);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error("The file link could not be created. Please try again.");
    preview.location.href = data.signedUrl;
  } catch (error) {
    preview?.close();
    toast.error(errorMessage(error));
  }
}

export function fmtSize(n?: number | null) {
  if (n == null || !Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
