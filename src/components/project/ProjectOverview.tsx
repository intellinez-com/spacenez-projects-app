import { useQuery } from "@tanstack/react-query";
import { format, isValid, parseISO } from "date-fns";
import { FileText } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { progressOf, stageLabel, statusLabel } from "@/lib/constants";
import { isTaskOverdue } from "@/lib/task-dates";
import { Button } from "@/components/ui/button";
import { type Task, type Doc, openDoc, fmtSize } from "./data";
import { RecentProjectUpdates } from "./ProjectUpdates";

type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
export type ProjectOverviewProps = {
  project: ProjectRow; tasks: Task[]; documents: Doc[];
  onOpenTask: (task: Task) => void; onOpenFiles: () => void; onOpenUpdates: () => void;
};

export function displayProjectDate(value: string | null) {
  if (!value) return "Not set";
  const date = parseISO(value);
  return isValid(date) ? format(date, "d MMM yyyy") : "Not set";
}

export function ProjectOverview({ project, tasks, documents, onOpenTask, onOpenFiles, onOpenUpdates }: ProjectOverviewProps) {
  const projectTasks = tasks.filter((task) => task.project_id === project.id);
  const openTasks = projectTasks.filter((task) => task.status !== "done");
  const completed = projectTasks.length - openTasks.length;
  const percent = progressOf(projectTasks);
  const overdue = openTasks.filter((task) => isTaskOverdue(task));
  const nextDue = openTasks.filter((task) => task.due_date && isValid(parseISO(task.due_date)) && !isTaskOverdue(task)).sort((left, right) => left.due_date!.localeCompare(right.due_date!))[0];
  const attention = [...openTasks].sort((left, right) => {
    const late = Number(isTaskOverdue(right)) - Number(isTaskOverdue(left));
    if (late) return late;
    return (left.due_date || left.start_date || "9999").localeCompare(right.due_date || right.start_date || "9999") || left.position - right.position;
  }).slice(0, 5);
  const files = documents.filter((document) => document.project_id === project.id && document.path.startsWith(`${project.id}/`) && !document.path.split("/").some((part) => part === "." || part === "..")).sort((left, right) => right.created_at.localeCompare(left.created_at));
  const photos = files.filter((document) => document.size !== null && document.size > 0 && document.size <= 5 * 1024 * 1024 && /\.(?:png|jpe?g|webp|gif|avif)$/i.test(document.name) && /\.(?:png|jpe?g|webp|gif|avif)$/i.test(document.path)).slice(0, 3);
  const photoPaths = photos.map((photo) => photo.path);
  const previews = useQuery({
    queryKey: ["project-photo-preview", project.id, photoPaths],
    enabled: photoPaths.length > 0,
    staleTime: 240_000, gcTime: 240_000, refetchInterval: 240_000, retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("project-files").createSignedUrls(photoPaths, 300);
      if (error) throw error;
      return data ?? [];
    },
  });
  const otherFiles = files.filter((file) => !photos.some((photo) => photo.id === file.id)).slice(0, 5);

  return (
    <div className="min-w-0 space-y-6 [overflow-wrap:anywhere] sm:space-y-8">
      <section aria-labelledby="project-progress-heading" className="min-w-0 space-y-4 rounded-lg border p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2"><h2 id="project-progress-heading" className="text-xl">Project progress</h2><span className="max-w-full text-sm">{project.status === "active" ? "Active" : project.status === "completed" ? "Completed" : project.status === "on_hold" ? "On hold" : project.status}</span></div>
        <p className="text-sm">Current stage: <strong>{stageLabel(project.current_stage)}</strong></p>
        <div className="space-y-2"><div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm"><label htmlFor={`project-progress-${project.id}`}>Tasks completed</label><span>{completed} of {projectTasks.length} ({percent}%)</span></div><progress id={`project-progress-${project.id}`} className="h-2 w-full accent-primary" value={percent} max={100}>{percent}%</progress></div>
        <dl className="grid gap-3 text-sm sm:grid-cols-3"><div className="min-w-0"><dt className="text-muted-foreground">Project start</dt><dd className="mt-1">{displayProjectDate(project.start_date)}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">Target handover</dt><dd className="mt-1">{displayProjectDate(project.target_date)}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">Next due date</dt><dd className="mt-1">{nextDue ? displayProjectDate(nextDue.due_date) : "No upcoming due dates set"}</dd></div></dl>
        {projectTasks.length === 0 && <p className="text-sm text-muted-foreground">Tasks have not been added yet.</p>}
        {overdue.length > 0 && <p className="text-sm text-destructive">{overdue.length} {overdue.length === 1 ? "task is" : "tasks are"} overdue.</p>}
        {openTasks.some((task) => !task.due_date) && <p className="text-sm text-muted-foreground">{openTasks.filter((task) => !task.due_date).length} open tasks have no due date yet.</p>}
      </section>

      <section aria-labelledby="open-work-heading" className="min-w-0 space-y-3">
        <h2 id="open-work-heading" className="text-lg">Upcoming and open work</h2>
        {attention.length === 0 ? <p className="text-sm text-muted-foreground">{projectTasks.length ? "All current tasks are complete." : "The team will add project tasks here."}</p> : <ul className="divide-y rounded-lg border">{attention.map((task) => <li key={task.id} className="min-w-0"><button type="button" onClick={() => onOpenTask(task)} className="grid min-h-11 w-full min-w-0 gap-3 p-4 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0"><p className="text-sm font-medium">{task.title}</p><p className="mt-1 text-sm text-muted-foreground">{stageLabel(task.stage)} · {statusLabel(task.status)}</p></div><div className="min-w-0 space-y-1 text-sm"><p className="text-muted-foreground">{task.start_date ? `Starts ${displayProjectDate(task.start_date)}` : "Start date not set"}</p><p className={isTaskOverdue(task) ? "text-destructive" : "text-muted-foreground"}>{task.due_date ? `${isTaskOverdue(task) ? "Overdue" : "Due"} ${displayProjectDate(task.due_date)}` : "Due date not set"}</p></div></button></li>)}</ul>}
        {openTasks.length > 5 && <p className="text-sm text-muted-foreground">Showing 5 of {openTasks.length} open tasks. Open the task list to see all work.</p>}
      </section>

      <section aria-labelledby="project-files-heading" className="min-w-0 space-y-3">
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between"><h2 id="project-files-heading" className="text-lg">Photos and files</h2><Button variant="outline" size="sm" className="min-h-11 max-w-full whitespace-normal text-sm" onClick={onOpenFiles}>All files ({files.length})</Button></div>
        {files.length === 0 && <p className="text-sm text-muted-foreground">No photos or documents have been shared yet.</p>}
        {photos.length > 0 && <div className="grid gap-3 sm:grid-cols-3">{photos.map((photo) => {
          const signedUrl = !previews.isError ? previews.data?.find((item) => item.path === photo.path)?.signedUrl : undefined;
          return <button key={photo.id} type="button" onClick={() => void openDoc(photo.path)} className="min-w-0 overflow-hidden rounded-lg border text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="flex aspect-video items-center justify-center bg-muted">{signedUrl ? <img src={signedUrl} alt={photo.name} loading="lazy" decoding="async" width={640} height={360} referrerPolicy="no-referrer" className="h-full w-full object-cover" /> : <FileText className="h-6 w-6 text-muted-foreground" />}</div><p className="px-3 py-2 text-sm [overflow-wrap:anywhere]">{photo.name}</p></button>;
        })}</div>}
        {previews.isError && photos.length > 0 && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm"><p>Photo previews are unavailable. Open a file to try again.</p><Button size="sm" variant="outline" className="min-h-11 whitespace-normal text-sm" onClick={() => void previews.refetch()}>Retry previews</Button></div>}
        {otherFiles.length > 0 && <ul className="divide-y rounded-lg border">{otherFiles.map((document) => <li key={document.id} className="min-w-0"><button type="button" onClick={() => void openDoc(document.path)} className="flex min-h-11 w-full min-w-0 items-start gap-3 p-3 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"><FileText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-oak" /><span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{document.name}</span><span className="shrink-0 text-xs text-muted-foreground">{fmtSize(document.size)}</span></button></li>)}</ul>}
      </section>

      <RecentProjectUpdates projectId={project.id} onOpenUpdates={onOpenUpdates} />
    </div>
  );
}
