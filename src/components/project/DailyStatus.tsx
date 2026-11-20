import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, isValid, parseISO } from "date-fns";
import { FileText } from "lucide-react";
import { loadActivityTracking, loadProjectActivity, projectActivityBounds, projectDay, type ActivityPeriod, type ProjectActivity } from "@/lib/project-activity";
import { activityChangeDetails, activityContent, activityCounts, activityDescription, activityPayload } from "@/lib/activity-description";
import { progressOf, statusLabel } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { fmtSize, openDoc, type Doc, type Task } from "./data";

export type DailyStatusProps = {
  projectId: string;
  tasks: Task[];
  documents: Doc[];
  canEdit?: boolean;
  onOpenTask: (task: Task) => void;
  onOpenFiles: () => void;
  onOpenUpdates?: () => void;
};

const PAGE_SIZE = 50;
const periods = [{ key: "today", label: "Today" }, { key: "week", label: "This week" }, { key: "all", label: "So far" }] as const;

function workDate(value: string) {
  const parsed = parseISO(value);
  return isValid(parsed) ? format(parsed, "d MMM yyyy") : "Date unavailable";
}

function activityDate(value: string) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? `${new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(parsed)} IST` : "Date unavailable";
}

function sortActivity(left: ProjectActivity, right: ProjectActivity) {
  return new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime() || right.id.localeCompare(left.id);
}

export function DailyStatus(props: DailyStatusProps) {
  return <DailyStatusContent key={props.projectId} {...props} />;
}

function DailyStatusContent({ projectId, tasks, documents, canEdit = false, onOpenTask, onOpenFiles, onOpenUpdates }: DailyStatusProps) {
  const [today, setToday] = useState(() => projectDay());
  const [period, setPeriod] = useState<ActivityPeriod>("today");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const updateDay = () => setToday(projectDay());
    const timer = window.setInterval(updateDay, 60_000);
    window.addEventListener("focus", updateDay);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", updateDay); };
  }, []);

  const now = new Date(`${today}T12:00:00+05:30`);
  const bounds = projectActivityBounds(period, now);
  const activity = useQuery({
    queryKey: ["project-activity", projectId, period, today, page],
    queryFn: () => loadProjectActivity(projectId, { period, offset: page * PAGE_SIZE, limit: PAGE_SIZE, now }),
    refetchInterval: 60_000,
  });
  const latest = useQuery({
    queryKey: ["project-activity", projectId, "latest", today],
    queryFn: () => loadProjectActivity(projectId, { period: "all", limit: 1, now }),
    refetchInterval: 60_000,
  });
  const tracking = useQuery({ queryKey: ["activity-tracking"], queryFn: loadActivityTracking, staleTime: Infinity });
  const inPeriod = (value: string) => { const timestamp = new Date(value).getTime(); return Number.isFinite(timestamp) && timestamp < new Date(bounds.to).getTime() && (!bounds.from || timestamp >= new Date(bounds.from).getTime()); };
  const fitsPeriod = (event: ProjectActivity) => event.project_id === projectId && inPeriod(event.occurred_at);
  const latestActivity = latest.data?.filter((event) => event.project_id === projectId).sort(sortActivity)[0];
  const available = [...(activity.data ?? []), ...(page === 0 && latestActivity ? [latestActivity] : [])].filter(fitsPeriod);
  const events = [...new Map(available.map((event) => [event.id, event])).values()].sort(sortActivity).slice(0, PAGE_SIZE);
  const days = new Map<string, ProjectActivity[]>();
  for (const event of events) {
    const date = new Date(event.occurred_at);
    const day = Number.isFinite(date.getTime()) ? projectDay(date) : "unknown";
    days.set(day, [...(days.get(day) ?? []), event]);
  }
  const counts = activityCounts(events);
  const countText = [
    counts.completedTasks ? `${counts.completedTasks} ${counts.completedTasks === 1 ? "task" : "tasks"} marked complete` : "",
    counts.statusChanges ? `${counts.statusChanges} task status ${counts.statusChanges === 1 ? "change" : "changes"}` : "",
    counts.filesShared ? `${counts.filesShared} ${counts.filesShared === 1 ? "file" : "files"} shared` : "",
    counts.comments ? `${counts.comments} ${counts.comments === 1 ? "comment" : "comments"}` : "",
  ].filter(Boolean).join(" · ");
  const projectTasks = tasks.filter((task) => task.project_id === projectId);
  const completed = projectTasks.filter((task) => task.status === "done").length;
  const inProgress = projectTasks.filter((task) => task.status === "in_progress").length;
  const blocked = projectTasks.filter((task) => task.status === "blocked").length;
  const percent = progressOf(projectTasks);
  const openTasks = projectTasks.filter((task) => task.status !== "done").sort((left, right) => Number(right.status === "blocked") - Number(left.status === "blocked") || (left.due_date || "9999").localeCompare(right.due_date || "9999") || left.position - right.position);
  const safeDocuments = documents.filter((document) => document.project_id === projectId && document.path.startsWith(`${projectId}/`) && !document.path.split("/").some((part) => part === "." || part === ".."));
  const files = safeDocuments.filter((document) => inPeriod(document.created_at)).sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
  const periodDescription = period === "today" ? `Today · ${workDate(today)}` : period === "week" ? `This week · Monday to ${workDate(today)}` : "All recorded activity";
  const filePeriod = period === "today" ? "today" : period === "week" ? "this week" : "so far";
  const emptyMessage = page > 0 ? "No older activity." : period === "today" ? "No activity recorded today." : period === "week" ? "No activity recorded this week." : "No project activity recorded yet.";

  function selectPeriod(value: ActivityPeriod) { setPeriod(value); setPage(0); }

  function entry(event: ProjectActivity) {
    const task = projectTasks.find((item) => item.id === event.task_id);
    const file = event.kind.startsWith("document_") ? safeDocuments.find((item) => item.id === event.source_id) : undefined;
    return <ActivityEntry event={event} key={event.id} onOpenTask={task ? () => onOpenTask(task) : undefined} onOpenFile={file ? () => void openDoc(file.path) : undefined} />;
  }

  return <div className="min-w-0 space-y-6 [overflow-wrap:anywhere]">
    <section aria-labelledby={`daily-status-heading-${projectId}`} className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id={`daily-status-heading-${projectId}`} className="text-xl">Daily status</h2>{onOpenUpdates && <Button type="button" variant="outline" className="min-h-11 whitespace-normal" onClick={onOpenUpdates}>{canEdit ? "Add a note" : "Ask the team"}</Button>}</div>
      <p className="text-sm text-muted-foreground">Task changes, photos, files and comments appear here automatically.</p>
      <div role="group" aria-label="Daily status period" className="grid grid-cols-3 gap-2 sm:max-w-sm">{periods.map((option) => <Button key={option.key} type="button" variant={period === option.key ? "default" : "outline"} aria-pressed={period === option.key} className="min-h-11 min-w-0 px-2 text-sm sm:px-4" onClick={() => selectPeriod(option.key)}>{option.label}</Button>)}</div>
      <p className="text-sm text-muted-foreground">{periodDescription} · India time</p>
      {activity.isError && <div role="alert" className="space-y-2 text-sm"><p>Project activity could not be refreshed.{events.length > 0 ? " Showing the available updates." : " Try again to check this period."}</p><Button type="button" variant="outline" className="min-h-11 whitespace-normal" onClick={() => void activity.refetch()}>Retry activity</Button></div>}
      {activity.isPending && events.length === 0 ? <p role="status" className="text-sm text-muted-foreground">Loading project activity…</p> : events.length > 0 ? <>
        <div className="space-y-1 text-sm"><p className="font-medium">{events.length} recorded {events.length === 1 ? "update" : "updates"}{page > 0 || activity.data?.length === PAGE_SIZE ? " on this page" : ""}</p>{countText && <p className="text-muted-foreground">In these updates: {countText}</p>}</div>
        <div className="space-y-5">{[...days].map(([day, entries]) => <section key={day} aria-label={day === "unknown" ? "Date unavailable" : `Activity on ${workDate(day)}`} className="space-y-2"><h3 className="text-sm font-medium">{day === "unknown" ? "Date unavailable" : workDate(day)}</h3><ol className="min-w-0 divide-y rounded-lg border bg-card">{entries.map((event) => <li key={event.id} className="min-w-0">{entry(event)}</li>)}</ol></section>)}</div>
      </> : !activity.isError && <div className="space-y-3 rounded-lg border p-4 sm:p-5"><p className="text-sm font-medium">{emptyMessage}</p>{page === 0 && period !== "all" && latestActivity && !fitsPeriod(latestActivity) && <div className="space-y-2 border-t pt-3"><p className="text-sm font-medium">Latest earlier update</p><div className="rounded-lg border bg-card">{entry(latestActivity)}</div><Button type="button" variant="outline" className="min-h-11 w-full whitespace-normal sm:w-auto" onClick={() => selectPeriod("all")}>See previous activity</Button></div>}{page === 0 && period !== "all" && latest.isError && !latestActivity && <div role="alert" className="space-y-2 text-sm"><p>The latest earlier activity could not be checked.</p><Button type="button" variant="outline" className="min-h-11 whitespace-normal" onClick={() => void latest.refetch()}>Retry latest activity</Button></div>}</div>}
      {(page > 0 || activity.data?.length === PAGE_SIZE) && <div className="flex flex-wrap gap-2">{page > 0 && <Button type="button" variant="outline" className="min-h-11 flex-1 whitespace-normal sm:flex-none" disabled={activity.isFetching} onClick={() => setPage((value) => value - 1)}>Newer activity</Button>}{activity.data?.length === PAGE_SIZE && <Button type="button" variant="outline" className="min-h-11 flex-1 whitespace-normal sm:flex-none" disabled={activity.isFetching} onClick={() => setPage((value) => value + 1)}>Older activity</Button>}</div>}
      {tracking.data?.started_at ? <p className="text-xs text-muted-foreground">Detailed change history starts {activityDate(tracking.data.started_at)}. Earlier files, comments and approvals may also appear.</p> : tracking.isError && <p className="text-xs text-muted-foreground">Earlier task changes may be unavailable. The history start date could not be checked.</p>}
    </section>

    <section aria-labelledby={`daily-files-heading-${projectId}`} className="min-w-0 space-y-3 border-t pt-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 id={`daily-files-heading-${projectId}`} className="text-lg">Files shared {filePeriod}</h3><Button type="button" variant="outline" className="min-h-11 w-full whitespace-normal sm:w-auto" onClick={onOpenFiles}>All photos & files</Button></div>{files.length === 0 ? <p className="text-sm text-muted-foreground">No files shared {filePeriod}.</p> : <ul className="min-w-0 divide-y rounded-lg border">{files.slice(0, 5).map((file) => <li key={file.id}><button type="button" className="flex min-h-11 w-full min-w-0 items-start gap-3 p-3 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => void openDoc(file.path)}><FileText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 flex-1"><span className="block [overflow-wrap:anywhere]">{file.name}</span><span className="mt-1 block text-xs text-muted-foreground">Shared {activityDate(file.created_at)}</span></span><span className="shrink-0 text-xs text-muted-foreground">{fmtSize(file.size)}</span></button></li>)}</ul>}{files.length > 5 && <p className="text-sm text-muted-foreground">Showing 5 of {files.length} files shared {filePeriod}. Open Photos & files to see all.</p>}</section>

    <section aria-labelledby={`overall-status-heading-${projectId}`} className="min-w-0 space-y-3 border-t pt-5"><h3 id={`overall-status-heading-${projectId}`} className="text-lg">Overall progress so far</h3>{projectTasks.length === 0 ? <p className="text-sm text-muted-foreground">Tasks have not been added yet.</p> : <><div className="flex flex-wrap items-baseline justify-between gap-2 text-sm"><label htmlFor={`daily-progress-${projectId}`}>Tasks completed so far</label><span>{completed} of {projectTasks.length} ({percent}%)</span></div><progress id={`daily-progress-${projectId}`} className="h-2 w-full accent-primary" value={percent} max={100}>{percent}%</progress><p className="text-sm">Currently: {inProgress} in progress · {blocked} blocked · {projectTasks.filter((task) => task.status === "review").length} awaiting review</p>{openTasks.length > 0 && <div className="space-y-2"><h4 className="text-sm font-medium">Open work and due dates</h4><ul className="min-w-0 divide-y rounded-lg border">{openTasks.slice(0, 3).map((task) => <li key={task.id}><button type="button" className="flex min-h-11 w-full min-w-0 flex-col gap-1 p-3 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:flex-row sm:items-start sm:justify-between sm:gap-3" onClick={() => onOpenTask(task)}><span className="min-w-0 [overflow-wrap:anywhere]">{task.title}<span className="mt-1 block text-xs text-muted-foreground">{statusLabel(task.status)}</span></span><span className={`shrink-0 text-xs ${task.due_date && task.due_date < today ? "text-destructive" : "text-muted-foreground"}`}>{task.due_date ? `${task.due_date < today ? "Overdue" : "Due"} ${workDate(task.due_date)}` : "Due date not set"}</span></button></li>)}</ul></div>}</>}</section>
  </div>;
}

function ActivityEntry({ event, onOpenTask, onOpenFile }: { event: ProjectActivity; onOpenTask?: (() => void) | undefined; onOpenFile?: (() => void) | undefined }) {
  const changes = activityChangeDetails(event);
  const content = activityContent(event);
  return <article className="min-w-0 space-y-2 p-3 [overflow-wrap:anywhere] sm:p-4">
    <p className="text-sm leading-relaxed"><span className="font-medium">{event.author?.full_name || event.author?.email || (event.actor_id ? "Project member" : "System")}</span> {activityDescription(event)}.</p>
    <time dateTime={event.occurred_at} className="block text-xs text-muted-foreground">{activityDate(event.occurred_at)}</time>
    {changes.length > 0 && <ul className="space-y-1 text-sm text-muted-foreground">{changes.map((change) => <li key={change}>{change}</li>)}</ul>}
    {content.map((item) => <ActivityText key={item.label} label={item.label} body={item.body} />)}
    {activityPayload(event)["historical"] === true && <p className="text-xs text-muted-foreground">Earlier record</p>}
    {(onOpenTask || onOpenFile) && <div className="flex flex-wrap gap-2">{onOpenTask && <Button type="button" variant="outline" size="sm" className="min-h-11 whitespace-normal" onClick={onOpenTask}>Open task</Button>}{onOpenFile && <Button type="button" variant="outline" size="sm" className="min-h-11 whitespace-normal" onClick={onOpenFile}>Open file</Button>}</div>}
  </article>;
}

function ActivityText({ label, body }: { label: string; body: string }) {
  const [expanded, setExpanded] = useState(false);
  const shortened = body.length > 400;
  return <div className="space-y-1 text-sm"><p className="font-medium">{label}</p><p className="whitespace-pre-wrap leading-relaxed">{shortened && !expanded ? `${body.slice(0, 400)}…` : body}</p>{shortened && <Button type="button" size="sm" variant="outline" className="min-h-11 whitespace-normal" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Show less" : `Read full ${label.toLowerCase()}`}</Button>}</div>;
}
