import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, MapPin, CalendarDays, AlertTriangle } from "lucide-react";
import { format, parseISO } from "date-fns";
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
import { isTaskOverdue } from "@/lib/task-dates";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Projects — Spacenez Track" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { data: me } = useMe();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const [{ data: projects, error }, { data: tasks, error: taskError }] = await Promise.all([
        supabase.from("projects").select("*").order("created_at", { ascending: false }),
        supabase.from("tasks").select("id, project_id, status, due_date"),
      ]);
      if (error) throw error;
      if (taskError) throw taskError;
      return { projects: projects ?? [], tasks: tasks ?? [] };
    },
  });

  const projects = data?.projects ?? [];
  const tasks = data?.tasks ?? [];
  const overdue = tasks.filter((task) => isTaskOverdue(task));
  const inExecution = projects.filter((p) => p.current_stage === "execution").length;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{me?.isAdmin ? "Studio overview" : "Your projects"}</p>
          <h1 className="mt-1 text-4xl">Projects</h1>
        </div>
        {me?.isAdmin && <div className="flex flex-wrap gap-2"><ProjectImportDialog /><NewProjectDialog /></div>}
      </div>

      {!isError && !isLoading && <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active projects" value={projects.filter((p) => p.status === "active").length} />
        <Stat label="In execution" value={inExecution} />
        <Stat label="Open tasks" value={tasks.filter((t) => t.status !== "done").length} />
        <Stat label="Overdue tasks" value={overdue.length} warn={overdue.length > 0} />
      </div>}

      {!isError && me?.isAdmin && projects.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl">Pipeline by stage</h2>
          <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
            {STAGES.map((s) => {
              const n = projects.filter((p) => p.current_stage === s.key).length;
              return (
                <div key={s.key} className="min-w-36 flex-1 rounded-lg border bg-card p-3">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="font-display text-2xl">{n}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-10">
        {isError ? (
          <div role="alert" className="space-y-3 rounded-lg border p-5">
            <p>Could not load projects and tasks. The totals are unavailable.</p>
            <Button variant="outline" onClick={() => void refetch()}>Try again</Button>
          </div>
        ) : isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-12 text-center">
            <p className="font-display text-2xl">No projects yet</p>
            <p className="mt-2 text-muted-foreground">
              {me?.isAdmin ? "Create your first project to get started." : "You'll see projects here once Spacenez shares them with you."}
            </p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => {
              const pt = tasks.filter((t) => t.project_id === p.id);
              const pct = progressOf(pt);
              return (
                <Link
                  key={p.id}
                  to="/projects/$id"
                  params={{ id: p.id }}
                  className="group rounded-xl border bg-card p-5 shadow-soft transition hover:-translate-y-0.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="eyebrow">{p.project_type}</p>
                      <h3 className="mt-1 text-xl group-hover:text-oak">{p.name}</h3>
                    </div>
                    <span className="font-display text-2xl">{pct}%</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {p.client_name && <span>{p.client_name}</span>}
                    {p.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{p.location}</span>}
                    {p.target_date && <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{format(parseISO(p.target_date), "d MMM yyyy")}</span>}
                  </div>
                  <div className="mt-5">
                    <StageTrack current={stageIndex(p.current_stage)} />
                    <p className="mt-2 text-sm">
                      <span className="text-muted-foreground">Stage:</span> {stageLabel(p.current_stage)}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4">
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
        <Button><Plus className="h-4 w-4" /> New project</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-2xl">New project</DialogTitle></DialogHeader>
        {creationError && <p role="alert" className="text-sm text-destructive">{creationError}</p>}
        {createdProjectId ? <Button asChild><Link to="/projects/$id" params={{ id: createdProjectId }} onClick={() => setOpen(false)}>Open created project</Link></Button> : <form onSubmit={create} className="space-y-3">
          <div className="space-y-1.5"><Label>Project name</Label><Input required value={form.name} onChange={set("name")} placeholder="3BHK — Sector 70, Mohali" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Client</Label><Input value={form.client_name} onChange={set("client_name")} /></div>
            <div className="space-y-1.5"><Label>Location</Label><Input value={form.location} onChange={set("location")} /></div>
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={form.project_type} onValueChange={(v) => setForm({ ...form, project_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PROJECT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
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
