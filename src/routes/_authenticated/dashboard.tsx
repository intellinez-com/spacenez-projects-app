import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, MapPin, CalendarDays, AlertTriangle } from "lucide-react";
import { format, isValid, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { STAGES, PROJECT_TYPES, stageIndex, stageLabel, progressOf } from "@/lib/constants";
import { StageTrack } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProjectImportDialog } from "@/components/project/ProjectImportDialog";
import { DuplicateProjectDialog } from "@/components/project/DuplicateProjectDialog";
import { isTaskOverdue } from "@/lib/task-dates";
import { projectTypeLabel } from "@/lib/project-type";
import { projectDay } from "@/lib/daily-updates";
import { loadLatestProjectActivity, type ProjectActivity } from "@/lib/project-activity";
import { activityDescription } from "@/lib/activity-description";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Projects — Spacenez Track" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { data: me } = useMe();
  const [duplicateSource, setDuplicateSource] = useState<{ id: string; name: string; project_type: string } | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const [{ data: projects, error }, { data: tasks, error: taskError }, { data: stages, error: stageError }] = await Promise.all([
        supabase.from("projects").select("*").order("created_at", { ascending: false }),
        supabase.from("tasks").select("id, project_id, status, due_date"),
        supabase.from("project_stages").select("project_id,key,label,position,archived_at").order("position"),
      ]);
      if (error) throw error;
      if (taskError) throw taskError;
      if (stageError) throw stageError;
      return { projects: projects ?? [], tasks: tasks ?? [], stages: stages ?? [] };
    },
  });

  const projects = data?.projects ?? [];
  const tasks = data?.tasks ?? [];
  const stages = data?.stages ?? [];
  const overdue = tasks.filter((task) => isTaskOverdue(task));
  const currentHeadings = new Map<string, number>();
  for (const project of projects) {
    const label = stageLabel(project.current_stage, stages.filter((stage) => stage.project_id === project.id));
    currentHeadings.set(label, (currentHeadings.get(label) ?? 0) + 1);
  }
  const projectIds = projects.map((project) => project.id);
  const [today, setToday] = useState(() => projectDay());
  useEffect(() => {
    const updateDay = () => setToday(projectDay());
    const timer = window.setInterval(updateDay, 60_000);
    window.addEventListener("focus", updateDay);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", updateDay); };
  }, []);
  const activity = useQuery({
    queryKey: ["project-activity", "dashboard", projectIds, today],
    queryFn: () => loadLatestProjectActivity(projectIds),
    enabled: !isLoading && !isError && projectIds.length > 0,
    refetchInterval: 60_000,
  });

  return (
    <div className="mx-auto min-w-0 max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {me?.isAdmin && <p className="eyebrow">Studio overview</p>}
          <h1 className="mt-1 text-3xl sm:text-4xl">{me?.isAdmin ? "Projects" : "Your project updates"}</h1>
        </div>
        {me?.isAdmin && <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap"><ProjectImportDialog /><NewProjectDialog /></div>}
      </div>

      {me?.isAdmin && !isError && !isLoading && <div className="mt-6 grid grid-cols-2 gap-3 sm:mt-8 sm:gap-4 lg:grid-cols-4">
        <Stat label="Active projects" value={projects.filter((p) => p.status === "active").length} />
        <Stat label="On hold" value={projects.filter((project) => project.status === "on_hold").length} />
        <Stat label="Open tasks" value={tasks.filter((t) => t.status !== "done").length} />
        <Stat label="Overdue tasks" value={overdue.length} warn={overdue.length > 0} />
      </div>}

      {!isError && me?.isAdmin && projects.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl">Pipeline by stage</h2>
          <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
            {[...currentHeadings].map(([label, count]) => {
              return (
                <div key={label} className="min-w-36 flex-1 rounded-lg border bg-card p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-display text-2xl">{count}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-6 sm:mt-8">
        {!isError && projects.length > 0 && activity.isError && (
          <div role="alert" className="mb-4 space-y-3 rounded-lg border p-4 text-sm">
            <p>{activity.data ? "Daily activity could not be refreshed. Showing the last loaded activity." : "Daily activity could not be loaded. You can still open your project."}</p>
            <Button variant="outline" size="sm" className="min-h-11 whitespace-normal" disabled={activity.isFetching} onClick={() => void activity.refetch()}>Retry daily activity</Button>
          </div>
        )}
        {isError ? (
          <div role="alert" className="space-y-3 rounded-lg border p-5">
            <p>{me?.isAdmin ? "Could not load projects and tasks. The totals are unavailable." : "Your projects could not be loaded. Please try again."}</p>
            <Button variant="outline" onClick={() => void refetch()}>Try again</Button>
          </div>
        ) : isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card px-4 py-10 text-center sm:p-12">
            <p className="font-display text-2xl">No projects yet</p>
            <p className="mt-2 text-muted-foreground">
              {me?.isAdmin ? "Create your first project to get started." : "You'll see projects here once Spacenez shares them with you."}
            </p>
          </div>
        ) : (
          <div className="grid min-w-0 gap-4 sm:gap-5 lg:grid-cols-2 2xl:grid-cols-3">
            {projects.map((p) => {
              const pt = tasks.filter((t) => t.project_id === p.id);
              const pct = progressOf(pt);
              const typeLabel = projectTypeLabel(p.project_type);
              const projectStages = stages.filter((stage) => stage.project_id === p.id && !stage.archived_at);
              return (
                <article key={p.id} className="min-w-0 rounded-lg border bg-card">
                <Link
                  to="/projects/$id"
                  params={{ id: p.id }}
                  aria-label={`Open daily status for ${p.name}`}
                  className="group block min-w-0 p-4 transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {typeLabel && <p className="eyebrow">{typeLabel}</p>}
                      <h2 className="mt-1 break-words text-xl group-hover:text-oak">{p.name}</h2>
                    </div>
                    <span className="shrink-0 font-display text-2xl">{pct}%</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {p.client_name && <span className="min-w-0 break-words">{p.client_name}</span>}
                    {p.location && <span className="flex min-w-0 max-w-full items-start gap-1"><MapPin className="mt-0.5 h-3 w-3 shrink-0" /><span className="min-w-0 break-words">{p.location}</span></span>}
                    {p.target_date && <span className="flex items-center gap-1 whitespace-nowrap"><CalendarDays className="h-3 w-3 shrink-0" />{format(parseISO(p.target_date), "d MMM yyyy")}</span>}
                  </div>
                  <div className="mt-4 min-w-0 space-y-2 border-y py-4 [overflow-wrap:anywhere]">
                    <LatestProjectActivity
                      event={activity.data?.[p.id]}
                      today={today}
                      loading={activity.isPending}
                      unavailable={activity.isError && !activity.data}
                    />
                    <p className="pt-1 text-sm font-medium text-oak">Open daily status →</p>
                  </div>
                  <div className="mt-5">
                    <StageTrack current={stageIndex(p.current_stage, projectStages)} stages={projectStages} />
                    <p className="mt-2 text-sm">
                      <span className="text-muted-foreground">Stage:</span> {stageLabel(p.current_stage, projectStages)}
                    </p>
                  </div>
                </Link>
                {me?.isAdmin && <div className="border-t px-3 py-1"><Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => setDuplicateSource({ id: p.id, name: p.name, project_type: p.project_type })}>Duplicate project</Button></div>}
                </article>
              );
            })}
          </div>
        )}
      </section>
      {me?.isAdmin && duplicateSource && <DuplicateProjectDialog source={duplicateSource} actorId={me.id} open={true} onOpenChange={(open) => { if (!open) setDuplicateSource(null); }} />}
    </div>
  );
}

function activityTime(value: string) {
  const date = new Date(value);
  return isValid(date) ? `${new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date)} IST` : "Date unavailable";
}

function LatestProjectActivity({ event, today, loading, unavailable }: { event: ProjectActivity | null | undefined; today: string; loading: boolean; unavailable: boolean }) {
  if (loading) return <p role="status" className="text-sm text-muted-foreground">Loading daily activity…</p>;
  if (unavailable || event === undefined) return <p className="text-sm text-muted-foreground">Daily activity is unavailable.</p>;
  const happenedToday = !!event && isValid(new Date(event.occurred_at)) && projectDay(new Date(event.occurred_at)) === today;
  return <>
    {happenedToday ? <p className="text-sm font-medium">Today’s activity</p> : <p className="text-sm font-medium">No activity recorded today.</p>}
    {event ? <>
      <p className="text-xs text-muted-foreground">{happenedToday ? "Latest change: " : "Latest activity: "}<time dateTime={event.occurred_at}>{activityTime(event.occurred_at)}</time></p>
      <p className="line-clamp-3 text-sm leading-relaxed"><span className="font-medium">{event.author?.full_name || event.author?.email || (event.actor_id ? "Project member" : "System")}</span> {activityDescription(event)}</p>
    </> : <p className="text-sm text-muted-foreground">Project changes will appear here automatically.</p>}
  </>;
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3 sm:p-4">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {warn && <AlertTriangle className="h-3 w-3 text-destructive" />} {label}
      </p>
      <p className="mt-1 font-display text-3xl">{value}</p>
    </div>
  );
}

const DEFAULT_TASKS: Record<string, string[]> = {
  planning: ["Kick-off meeting & brief", "Budget & scope sign-off"],
  site_survey: ["Site measurements", "Site photographs"],
  layout_2d: ["Furniture layout plan", "Layout revisions"],
  mood_boards: ["Mood board & style direction"],
  design_3d: ["3D views — key rooms"],
  interior_design: ["Material & finish selection", "Lighting plan"],
  drawings: ["Working drawings", "BOQ & cost estimate"],
  approvals: ["Client design approval"],
  procurement: ["Vendor quotes", "Order placement"],
  execution: ["Civil & electrical work", "Carpentry & installation", "Site inspection"],
  handover: ["Snag list closure", "Final handover"],
};

function NewProjectDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creationError, setCreationError] = useState("");
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const submitting = useRef(false);
  const [form, setForm] = useState({ name: "", client_name: "", location: "", project_type: "Apartment", description: "", start_date: "", target_date: "" });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current || createdProjectId) return;
    if (form.start_date && form.target_date && form.target_date < form.start_date) { setCreationError("Target handover must be on or after the start date."); return; }
    submitting.current = true; setBusy(true); setCreationError("");
    try {
      const { data: u, error: authError } = await supabase.auth.getUser();
      if (authError || !u.user) throw new Error("Your session has expired. Sign in again.");
      const { data: p, error } = await supabase
        .from("projects")
        .insert({ ...form, start_date: form.start_date || null, target_date: form.target_date || null, created_by: u.user.id })
        .select()
        .single();
      if (error) throw error;
      setCreatedProjectId(p.id);
      let pos = 0;
      const rows = STAGES.flatMap((s) => (DEFAULT_TASKS[s.key] ?? []).map((title) => ({ project_id: p.id, title, stage: s.key, position: pos++, created_by: u.user.id })));
      const { error: seedError } = await supabase.from("tasks").insert(rows);
      void qc.invalidateQueries({ queryKey: ["projects"] });
      if (seedError) {
        setCreationError("The project was created, but its starter tasks could not be added. Open the existing project to add tasks; do not create it again.");
        return;
      }
      toast.success("Project created with starter tasks");
      setOpen(false);
      setCreatedProjectId(null);
      setForm({ name: "", client_name: "", location: "", project_type: "Apartment", description: "", start_date: "", target_date: "" });
    } catch (failure) {
      setCreationError(failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "Could not create project.");
    } finally { submitting.current = false; setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!submitting.current) setOpen(value); }}>
      <DialogTrigger asChild>
        <Button className="w-full sm:w-auto"><Plus className="h-4 w-4" /> New project</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-2xl">New project</DialogTitle></DialogHeader>
        {creationError && <p role="alert" className="break-words text-sm text-destructive">{creationError}</p>}
        {createdProjectId ? <Button asChild className="w-full sm:w-auto"><Link to="/projects/$id" params={{ id: createdProjectId }} onClick={() => setOpen(false)}>Open created project</Link></Button> : <form onSubmit={create} className="min-w-0 space-y-3">
          <div className="space-y-1.5"><Label>Project name</Label><Input required value={form.name} onChange={set("name")} placeholder="3BHK — Sector 70, Mohali" /></div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Client</Label><Input value={form.client_name} onChange={set("client_name")} /></div>
            <div className="space-y-1.5"><Label>Location</Label><Input value={form.location} onChange={set("location")} /></div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-project-type">Project type</Label>
            <Select value={form.project_type} onValueChange={(v) => setForm({ ...form, project_type: v })}>
              <SelectTrigger id="new-project-type"><SelectValue /></SelectTrigger>
              <SelectContent>{PROJECT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Start</Label><Input type="date" value={form.start_date} onChange={set("start_date")} /></div>
            <div className="space-y-1.5"><Label>Target handover</Label><Input type="date" value={form.target_date} onChange={set("target_date")} /></div>
          </div>
          <div className="space-y-1.5"><Label>Notes</Label><Textarea value={form.description} onChange={set("description")} /></div>
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating…" : "Create project"}</Button>
        </form>}
      </DialogContent>
    </Dialog>
  );
}
