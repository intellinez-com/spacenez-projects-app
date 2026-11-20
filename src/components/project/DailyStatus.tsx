import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isValid, parseISO } from "date-fns";
import { FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { dailyUpdateBounds, loadDailyUpdates, projectDay, type DailyUpdate, type DailyUpdatePeriod } from "@/lib/daily-updates";
import { progressOf, statusLabel } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, fmtSize, openDoc, type Doc, type Task } from "./data";

export type DailyStatusProps = {
  projectId: string;
  tasks: Task[];
  documents: Doc[];
  canEdit: boolean;
  onOpenTask: (task: Task) => void;
  onOpenFiles: () => void;
};

const PAGE_SIZE = 50;
const periods = [{ key: "today", label: "Today" }, { key: "week", label: "This week" }, { key: "all", label: "So far" }] as const;

function workDate(value: string) {
  const date = parseISO(value);
  return isValid(date) ? format(date, "d MMM yyyy") : "Date unavailable";
}

function postedDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date)} IST` : "Date unavailable";
}

function sortReports(left: DailyUpdate, right: DailyUpdate) {
  return right.report_date.localeCompare(left.report_date) || right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id);
}

function validWorkDate(value: string, today: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value)) && value <= today;
}

export function DailyStatus(props: DailyStatusProps) {
  return <DailyStatusContent key={props.projectId} {...props} />;
}

function DailyStatusContent({ projectId, tasks, documents, canEdit, onOpenTask, onOpenFiles }: DailyStatusProps) {
  const qc = useQueryClient();
  const [today, setToday] = useState(() => projectDay());
  const [period, setPeriod] = useState<DailyUpdatePeriod>("today");
  const [page, setPage] = useState(0);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState(() => ({ report_date: projectDay(), work_done: "", next_steps: "", blockers: "" }));
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedReport, setSavedReport] = useState<DailyUpdate | null>(null);
  const submitting = useRef(false);
  const submission = useRef<{ id: string; signature: string } | null>(null);
  const draftTouched = useRef(false);

  useEffect(() => {
    const updateDay = () => setToday(projectDay());
    const timer = window.setInterval(updateDay, 60_000);
    window.addEventListener("focus", updateDay);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", updateDay); };
  }, []);

  // The date keeps an open tab correct across midnight in the project's time zone.
  const now = new Date(`${today}T12:00:00+05:30`);
  const bounds = dailyUpdateBounds(period, now);
  const updates = useQuery({
    queryKey: ["daily-updates", projectId, period, today, page],
    queryFn: () => loadDailyUpdates(projectId, { period, offset: page * PAGE_SIZE, limit: PAGE_SIZE, now }),
    refetchInterval: 60_000,
  });
  const latest = useQuery({
    queryKey: ["daily-updates", projectId, "latest", today],
    queryFn: () => loadDailyUpdates(projectId, { period: "all", limit: 1, now }),
    refetchInterval: 60_000,
  });
  const fitsPeriod = (report: DailyUpdate) => report.project_id === projectId && report.report_date <= bounds.to && (!bounds.from || report.report_date >= bounds.from);
  const latestReport = [savedReport, ...(latest.data ?? [])].filter((report): report is DailyUpdate => !!report && report.project_id === projectId).sort(sortReports)[0];
  const availableReports = [...(updates.data ?? []), ...(page === 0 && savedReport ? [savedReport] : []), ...(page === 0 && latestReport ? [latestReport] : [])].filter(fitsPeriod);
  const reports = [...new Map(availableReports.map((report) => [report.id, report])).values()].sort(sortReports).slice(0, PAGE_SIZE);
  const projectTasks = tasks.filter((task) => task.project_id === projectId);
  const completed = projectTasks.filter((task) => task.status === "done").length;
  const inProgress = projectTasks.filter((task) => task.status === "in_progress").length;
  const blocked = projectTasks.filter((task) => task.status === "blocked").length;
  const percent = progressOf(projectTasks);
  const openTasks = projectTasks.filter((task) => task.status !== "done").sort((left, right) => Number(right.status === "blocked") - Number(left.status === "blocked") || (left.due_date || "9999").localeCompare(right.due_date || "9999") || left.position - right.position);
  const files = documents.filter((document) => {
    if (document.project_id !== projectId || !document.path.startsWith(`${projectId}/`) || document.path.split("/").some((part) => part === "." || part === "..")) return false;
    const date = new Date(document.created_at);
    if (!Number.isFinite(date.getTime())) return false;
    const day = projectDay(date);
    return day <= bounds.to && (!bounds.from || day >= bounds.from);
  }).sort((left, right) => right.created_at.localeCompare(left.created_at));
  const periodDescription = period === "today" ? `Today · ${workDate(today)}` : period === "week" ? `${workDate(bounds.from!)} – ${workDate(bounds.to)}` : "All daily reports";

  function selectPeriod(value: DailyUpdatePeriod) { setPeriod(value); setPage(0); }

  function toggleComposer() {
    if (!composing && !draftTouched.current) {
      const currentDay = projectDay();
      setToday(currentDay);
      setDraft((current) => ({ ...current, report_date: currentDay }));
    }
    setComposing((value) => !value);
  }

  function changeDraft(field: keyof typeof draft, value: string) {
    draftTouched.current = true;
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function post(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit || submitting.current) return;
    setPostError(""); setNotice("");
    if (!validWorkDate(draft.report_date, projectDay())) { setPostError("Choose a valid work date up to today."); return; }
    if (!draft.work_done.trim()) { setPostError("Describe the work or progress for this date."); return; }
    submitting.current = true; setPosting(true);
    try {
      const { data: session, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!session.user) throw new Error("Your session has expired. Sign in again before posting.");
      const fields = { project_id: projectId, report_date: draft.report_date, work_done: draft.work_done.trim(), next_steps: draft.next_steps.trim(), blockers: draft.blockers.trim(), created_by: session.user.id };
      const signature = JSON.stringify(fields);
      if (submission.current?.signature !== signature) submission.current = { id: crypto.randomUUID(), signature };
      const result = await supabase.from("project_daily_updates").insert({ ...fields, id: submission.current.id }).select("*,author:profiles(full_name,email)").single();
      let saved = result.data as DailyUpdate | null;
      if (result.error?.code === "23505") {
        // Retrying an interrupted response must not publish the same report twice.
        const previous = await supabase.from("project_daily_updates").select("*,author:profiles(full_name,email)").eq("id", submission.current.id).eq("project_id", projectId).maybeSingle();
        if (previous.error) throw previous.error;
        const row = previous.data;
        if (!row || row.report_date !== fields.report_date || row.work_done !== fields.work_done || row.next_steps !== fields.next_steps || row.blockers !== fields.blockers || row.created_by !== fields.created_by) throw result.error;
        saved = row as DailyUpdate;
      } else if (result.error) throw result.error;
      if (!saved) throw new Error("The daily update was not saved. Refresh and check your access.");
      setSavedReport(saved);
      const currentDay = projectDay();
      const week = dailyUpdateBounds("week");
      setToday(currentDay);
      selectPeriod(saved.report_date === currentDay ? "today" : saved.report_date >= week.from! ? "week" : "all");
      setDraft({ report_date: currentDay, work_done: "", next_steps: "", blockers: "" });
      submission.current = null;
      draftTouched.current = false;
      setComposing(false); setNotice("Daily update posted.");
      // Saving succeeded even if refreshing another panel subsequently fails.
      void qc.invalidateQueries({ queryKey: ["daily-updates"] }).catch(() => undefined);
    } catch (failure) { setPostError(errorMessage(failure, "The daily update could not be posted. Please try again.")); }
    finally { submitting.current = false; setPosting(false); }
  }

  const filePeriod = period === "today" ? "today" : period === "week" ? "this week" : "so far";
  const emptyMessage = page > 0 ? "No older daily updates." : period === "today" ? "No daily update posted today." : period === "week" ? "No daily updates posted this week." : "No daily updates posted yet.";

  return (
    <div className="min-w-0 space-y-6 [overflow-wrap:anywhere]">
      <section aria-labelledby={`daily-status-heading-${projectId}`} className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={`daily-status-heading-${projectId}`} className="text-xl">Daily status</h2>
          {canEdit && <Button type="button" variant="outline" className="min-h-11 w-full whitespace-normal sm:w-auto" aria-expanded={composing} aria-controls={`daily-update-form-${projectId}`} disabled={posting} onClick={toggleComposer}>{composing ? "Close daily update" : "Post daily update"}</Button>}
        </div>
        <div role="group" aria-label="Daily status period" className="grid grid-cols-3 gap-2 sm:max-w-sm">
          {periods.map((option) => <Button key={option.key} type="button" variant={period === option.key ? "default" : "outline"} aria-pressed={period === option.key} className="min-h-11 min-w-0 px-2 text-sm sm:px-4" onClick={() => selectPeriod(option.key)}>{option.label}</Button>)}
        </div>
        <p className="text-sm text-muted-foreground">{periodDescription} · India time</p>
        {notice && <p role="status" className="text-sm">{notice}</p>}

        {canEdit && composing && <form id={`daily-update-form-${projectId}`} onSubmit={post} aria-busy={posting} className="min-w-0 space-y-4 rounded-lg border bg-card p-4 sm:p-5">
          <div className="max-w-xs space-y-1.5"><Label htmlFor={`work-date-${projectId}`}>Work date</Label><Input id={`work-date-${projectId}`} name="report_date" type="date" max={today} required disabled={posting} value={draft.report_date} onChange={(event) => changeDraft("report_date", event.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor={`work-done-${projectId}`}>Work done / progress</Label><Textarea id={`work-done-${projectId}`} name="work_done" className="min-h-28 text-base md:text-sm" rows={4} maxLength={10_000} required disabled={posting} value={draft.work_done} onChange={(event) => changeDraft("work_done", event.target.value)} placeholder="Describe the work completed, progress made, or why no work happened." /></div>
          <div className="space-y-1.5"><Label htmlFor={`next-steps-${projectId}`}>Next steps (optional)</Label><Textarea id={`next-steps-${projectId}`} name="next_steps" className="text-base md:text-sm" rows={2} maxLength={10_000} disabled={posting} value={draft.next_steps} onChange={(event) => changeDraft("next_steps", event.target.value)} placeholder="What will happen next?" /></div>
          <div className="space-y-1.5"><Label htmlFor={`blockers-${projectId}`}>Delays / blockers (optional)</Label><Textarea id={`blockers-${projectId}`} name="blockers" className="text-base md:text-sm" rows={2} maxLength={10_000} disabled={posting} value={draft.blockers} onChange={(event) => changeDraft("blockers", event.target.value)} placeholder="Anything delaying progress or needing the client’s decision?" /></div>
          <p className="text-sm text-muted-foreground">This report is visible to the client. Photos can be shared in Photos & files.</p>
          {postError && <p role="alert" className="text-sm text-destructive">{postError}</p>}
          <Button type="submit" className="min-h-11 w-full whitespace-normal sm:w-auto" disabled={posting || !draft.work_done.trim()}>{posting ? "Posting daily update…" : "Share with client"}</Button>
        </form>}

        {updates.isError && <div role="alert" className="space-y-2 text-sm"><p>Daily updates could not be refreshed.{reports.length > 0 ? " Showing the available reports." : " Try again to check this period."}</p><Button type="button" variant="outline" className="min-h-11 whitespace-normal" onClick={() => void updates.refetch()}>Retry daily updates</Button></div>}
        {updates.isPending && reports.length === 0 ? <p role="status" className="text-sm text-muted-foreground">Loading daily updates…</p> : reports.length > 0 ? <ul className="min-w-0 space-y-3">{reports.map((report) => <li key={report.id}><DailyReport report={report} /></li>)}</ul> : !updates.isError && <div className="space-y-3 rounded-lg border p-4 sm:p-5">
          <p className="text-sm font-medium">{emptyMessage}</p>
          {page === 0 && period !== "all" && <p className="text-sm text-muted-foreground">The team has not shared a report for this period yet.</p>}
          {page === 0 && period !== "all" && latestReport && !fitsPeriod(latestReport) && <div className="space-y-3 border-t pt-3"><p className="text-sm font-medium">Last reported progress</p><DailyReport report={latestReport} /><Button type="button" variant="outline" className="min-h-11 w-full whitespace-normal sm:w-auto" onClick={() => selectPeriod("all")}>See previous updates</Button></div>}
          {page === 0 && period !== "all" && latest.isError && !latestReport && <div role="alert" className="space-y-2 text-sm"><p>The latest earlier update could not be checked.</p><Button type="button" variant="outline" className="min-h-11 whitespace-normal" onClick={() => void latest.refetch()}>Retry latest update</Button></div>}
        </div>}
        {(page > 0 || updates.data?.length === PAGE_SIZE) && <div className="flex flex-wrap gap-2">
          {page > 0 && <Button type="button" variant="outline" className="min-h-11 flex-1 whitespace-normal sm:flex-none" disabled={updates.isFetching} onClick={() => setPage((value) => value - 1)}>Newer daily updates</Button>}
          {updates.data?.length === PAGE_SIZE && <Button type="button" variant="outline" className="min-h-11 flex-1 whitespace-normal sm:flex-none" disabled={updates.isFetching} onClick={() => setPage((value) => value + 1)}>Older daily updates</Button>}
        </div>}
      </section>

      <section aria-labelledby={`daily-files-heading-${projectId}`} className="min-w-0 space-y-3 border-t pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 id={`daily-files-heading-${projectId}`} className="text-lg">Files shared {filePeriod}</h3><Button type="button" variant="outline" className="min-h-11 w-full whitespace-normal sm:w-auto" onClick={onOpenFiles}>All photos & files</Button></div>
        {files.length === 0 ? <p className="text-sm text-muted-foreground">No files shared {filePeriod}.</p> : <ul className="min-w-0 divide-y rounded-lg border">{files.slice(0, 5).map((file) => <li key={file.id}><button type="button" className="flex min-h-11 w-full min-w-0 items-start gap-3 p-3 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => void openDoc(file.path)}><FileText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 flex-1"><span className="block [overflow-wrap:anywhere]">{file.name}</span><span className="mt-1 block text-xs text-muted-foreground">Shared {postedDate(file.created_at)}</span></span><span className="shrink-0 text-xs text-muted-foreground">{fmtSize(file.size)}</span></button></li>)}</ul>}
        {files.length > 5 && <p className="text-sm text-muted-foreground">Showing 5 of {files.length} files shared {filePeriod}. Open Photos & files to see all.</p>}
      </section>

      <section aria-labelledby={`overall-status-heading-${projectId}`} className="min-w-0 space-y-3 border-t pt-5">
        <h3 id={`overall-status-heading-${projectId}`} className="text-lg">Overall progress so far</h3>
        {projectTasks.length === 0 ? <p className="text-sm text-muted-foreground">Tasks have not been added yet.</p> : <>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm"><label htmlFor={`daily-progress-${projectId}`}>Tasks completed so far</label><span>{completed} of {projectTasks.length} ({percent}%)</span></div>
          <progress id={`daily-progress-${projectId}`} className="h-2 w-full accent-primary" value={percent} max={100}>{percent}%</progress>
          <p className="text-sm">Currently: {inProgress} in progress · {blocked} blocked · {projectTasks.filter((task) => task.status === "review").length} awaiting review</p>
          {openTasks.length > 0 && <div className="space-y-2"><h4 className="text-sm font-medium">Open work and due dates</h4><ul className="min-w-0 divide-y rounded-lg border">{openTasks.slice(0, 3).map((task) => <li key={task.id}><button type="button" className="flex min-h-11 w-full min-w-0 flex-col gap-1 p-3 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:flex-row sm:items-start sm:justify-between sm:gap-3" onClick={() => onOpenTask(task)}><span className="min-w-0 [overflow-wrap:anywhere]">{task.title}<span className="mt-1 block text-xs text-muted-foreground">{statusLabel(task.status)}</span></span><span className={`shrink-0 text-xs ${task.due_date && task.due_date < today ? "text-destructive" : "text-muted-foreground"}`}>{task.due_date ? `${task.due_date < today ? "Overdue" : "Due"} ${workDate(task.due_date)}` : "Due date not set"}</span></button></li>)}</ul></div>}
        </>}
      </section>
    </div>
  );
}

function DailyReport({ report }: { report: DailyUpdate }) {
  return <article className="min-w-0 space-y-3 rounded-lg border bg-card p-4 [overflow-wrap:anywhere] sm:p-5">
    <header className="space-y-1"><h3 className="text-base font-medium">{workDate(report.report_date)}</h3><p className="text-xs text-muted-foreground">Posted <time dateTime={report.created_at}>{postedDate(report.created_at)}</time> · {report.author?.full_name || report.author?.email || "Spacenez team"}</p></header>
    <dl className="space-y-3 text-sm leading-relaxed"><div><dt className="font-medium">Work done / progress</dt><dd className="mt-1 whitespace-pre-wrap">{report.work_done}</dd></div>{report.next_steps.trim() && <div><dt className="font-medium">Next steps</dt><dd className="mt-1 whitespace-pre-wrap">{report.next_steps}</dd></div>}{report.blockers.trim() && <div><dt className="font-medium">Delays / blockers</dt><dd className="mt-1 whitespace-pre-wrap">{report.blockers}</dd></div>}</dl>
  </article>;
}
