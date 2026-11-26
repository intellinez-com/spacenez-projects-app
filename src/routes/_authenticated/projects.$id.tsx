import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { ArrowLeft, CalendarDays, FileText, Upload, Trash2, MapPin, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { STAGES, stageIndex, progressOf, stageLabel } from "@/lib/constants";
import { StageTrack } from "@/components/StatusPill";
import { safeMeetingUrl } from "@/lib/meeting-url";
import { errorMessage } from "@/lib/errors";
import { projectTypeLabel } from "@/lib/project-type";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableView, BoardView, TimelineView } from "@/components/project/Views";
import { TaskSheet } from "@/components/project/TaskSheet";
import { ApprovalOverview } from "@/components/project/approvals";
import { ProjectDetails } from "@/components/project/ProjectDetails";
import { ProjectOverview } from "@/components/project/ProjectOverview";
import { ProjectUpdates } from "@/components/project/ProjectUpdates";
import { DailyStatus } from "@/components/project/DailyStatus";
import { ProjectPayments } from "@/components/project/ProjectPayments";
import { ProjectNavigation } from "@/components/project/ProjectNavigation";
import { DuplicateProjectDialog } from "@/components/project/DuplicateProjectDialog";
import { useProject, useTaskMutations, uploadDoc, openDoc, fmtSize, type Task, type Profile, type Doc } from "@/components/project/data";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  head: () => ({ meta: [{ title: "Project — Spacenez Track" }] }),
  component: ProjectPage,
});

function ProjectPage() {
  const { id } = Route.useParams();
  const { data: me } = useMe();
  const { data, isLoading, error, refetch } = useProject(id);
  const qc = useQueryClient();
  const m = useTaskMutations(id);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<"comments" | "files" | undefined>();
  const [stageBusy, setStageBusy] = useState(false);
  const [selectedSection, setSelectedSection] = useState<{ projectId: string; value: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);

  if (isLoading) return <p className="p-8 text-muted-foreground">Loading…</p>;
  if (error && !data?.project) return <div className="space-y-3 p-8"><p role="alert" className="text-destructive">Project data could not be loaded. {error.message}</p><Button onClick={() => void refetch()}>Retry</Button></div>;
  if (!data?.project) return <p className="p-8 text-muted-foreground">Project not found or you don't have access.</p>;

  const { project, tasks, members, documents, people } = data;
  const stageCatalog = data.stages ?? STAGES;
  const activeStages = stageCatalog.filter((stage) => !("archived_at" in stage) || stage.archived_at === null);
  const myAccess = members.find((x) => x.user_id === me?.id)?.access;
  const canEdit = !!me?.isAdmin || myAccess === "partner";
  const canApprove = myAccess === "client";
  const meetingUrl = safeMeetingUrl(project.meeting_url);
  const openTask = tasks.find((t) => t.id === openId) ?? null;
  const pct = progressOf(tasks);
  const projectContext = [projectTypeLabel(project.project_type), project.client_brand?.trim() || project.client_name?.trim()].filter(Boolean).join(" · ");
  const allowedSections = ["daily", "overview", "table", "updates", "files", "approvals", "details", ...(canEdit ? ["board", "timeline"] : []), ...(me?.isAdmin ? ["payments", "team"] : [])];
  const defaultSection = canEdit ? "table" : "daily";
  const activeTab = selectedSection?.projectId === id && allowedSections.includes(selectedSection.value) ? selectedSection.value : defaultSection;
  const setActiveTab = (value: string) => setSelectedSection({ projectId: id, value });
  const openTaskPanel = (task: Task, section?: "comments" | "files") => { setOpenId(task.id); setOpenSection(section); };
  const refreshHeadings = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["project", id] }, { throwOnError: true }),
    qc.invalidateQueries({ queryKey: ["projects"] }),
    qc.invalidateQueries({ queryKey: ["task-approvals", id] }),
    qc.invalidateQueries({ queryKey: ["project-activity"] }),
  ]);

  async function refreshProject() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["project", id] }, { throwOnError: true }),
        qc.invalidateQueries({ queryKey: ["task-approvals", id] }, { throwOnError: true }),
        qc.invalidateQueries({ queryKey: ["project-updates", id] }, { throwOnError: true }),
        qc.invalidateQueries({ queryKey: ["comments", id] }, { throwOnError: true }),
        qc.invalidateQueries({ queryKey: ["daily-updates"] }, { throwOnError: true }),
        qc.invalidateQueries({ queryKey: ["project-activity"] }, { throwOnError: true }),
        qc.invalidateQueries({ queryKey: ["project-finance", id] }, { throwOnError: true }),
      ]);
    } catch { toast.error("Some project information could not be refreshed. Check your connection and try again."); }
    finally { setRefreshing(false); }
  }

  async function setStage(v: string) {
    if (!canEdit || stageBusy) return;
    setStageBusy(true);
    try {
      const { error: saveError, data: saved } = await supabase.from("projects").update({ current_stage: v }).eq("id", id).select("id").single();
      if (saveError) throw saveError;
      if (!saved) throw new Error("Stage was not saved. Refresh and check your access.");
      await m.refresh();
    } catch (err) { toast.error(errorMessage(err, "Stage could not be saved.")); }
    finally { setStageBusy(false); }
  }

  return (
    <div className="mx-auto min-w-0 max-w-[1600px] px-4 py-4 sm:px-6 sm:py-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/dashboard" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> All projects</Link>
        <Button variant="outline" size="sm" aria-label="Refresh project" disabled={refreshing} onClick={() => void refreshProject()}><RefreshCw className="h-4 w-4" />{refreshing ? "Refreshing…" : "Refresh"}</Button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">The latest project information could not be loaded. Showing the last loaded details; use Refresh to try again.</p>}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-full">
          <h1 className="text-2xl [overflow-wrap:anywhere] sm:text-3xl">{project.name}</h1>
          <p className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
            {projectContext && <span className="[overflow-wrap:anywhere]">{projectContext}</span>}
            {project.location && <span className="flex min-w-0 items-start gap-1 [overflow-wrap:anywhere]"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{project.location}</span>}
            {project.target_date && <span>Handover {format(parseISO(project.target_date), "d MMM yyyy")}</span>}
            {!canEdit && <span>{stageLabel(project.current_stage, stageCatalog)} · {pct}% of tasks complete</span>}
          </p>
        </div>
        {canEdit ? <div className="w-full max-w-xs space-y-2">
          <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
            <Select disabled={stageBusy} value={project.current_stage} onValueChange={(value) => void setStage(value)}>
              <SelectTrigger aria-label="Project stage" className="min-h-11 min-w-0 flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>{activeStages.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
            <span className="shrink-0 font-display text-2xl">{pct}%</span>
          </div>
          <StageTrack current={stageIndex(project.current_stage, activeStages)} stages={activeStages} />
          {meetingUrl && <Button asChild variant="outline" size="sm"><a href={meetingUrl} target="_blank" rel="noopener noreferrer"><CalendarDays className="h-4 w-4" /> Schedule a meeting</a></Button>}
        </div> : meetingUrl && <Button asChild variant="outline" size="sm"><a href={meetingUrl} target="_blank" rel="noopener noreferrer"><CalendarDays className="h-4 w-4" /> Schedule a meeting</a></Button>}
      </div>

      <div className="mt-5">
        <ProjectNavigation value={activeTab} canEdit={canEdit} isAdmin={!!me?.isAdmin} onChange={setActiveTab} {...(me?.isAdmin ? { onDuplicate: () => setDuplicateOpen(true) } : {})} />
        <div className="mt-4">
          {activeTab === "daily" && <DailyStatus key={id} projectId={id} tasks={tasks} documents={documents} canEdit={canEdit} onOpenTask={openTaskPanel} onOpenFiles={() => setActiveTab("files")} onOpenUpdates={() => setActiveTab("updates")} />}
          {activeTab === "overview" && <ProjectOverview project={project} tasks={tasks} documents={documents} stages={stageCatalog} onOpenTask={openTaskPanel} onOpenFiles={() => setActiveTab("files")} onOpenUpdates={() => setActiveTab("updates")} />}
          {activeTab === "table" && <TableView key={id} tasks={tasks} documents={documents} defaultStage={project.current_stage} people={people} canEdit={canEdit} stages={activeStages} stageCatalog={stageCatalog} onOpen={openTaskPanel} onUpdate={m.update} onAdd={m.add} {...(me?.isAdmin ? { headingManagement: { projectId: id, actorId: me.id, version: project.stage_revision ?? 0, currentStage: project.current_stage, onReload: refreshHeadings } } : {})} />}
          {activeTab === "board" && canEdit && <BoardView tasks={tasks} people={people} canEdit={canEdit} stages={activeStages} stageCatalog={stageCatalog} onOpen={openTaskPanel} onUpdate={m.update} />}
          {activeTab === "timeline" && canEdit && <TimelineView tasks={tasks} stages={activeStages} stageCatalog={stageCatalog} onOpen={openTaskPanel} />}
          {activeTab === "files" && <FilesTab projectId={id} canEdit={canEdit} documents={documents} tasks={tasks} onChange={refetch} />}
          {activeTab === "updates" && <ProjectUpdates projectId={id} canEdit={canEdit} />}
          {activeTab === "approvals" && <ApprovalOverview projectId={id} tasks={tasks} onOpen={openTaskPanel} />}
          {activeTab === "payments" && me?.isAdmin && <ProjectPayments key={id} projectId={id} />}
          {activeTab === "details" && <ProjectDetails key={id} project={project} canEdit={canEdit} onChange={m.refresh} />}
          {activeTab === "team" && me?.isAdmin && <TeamTab projectId={id} members={members} onChange={refetch} />}
        </div>
      </div>

      <TaskSheet
        task={openTask}
        projectId={id}
        canEdit={canEdit}
        canApprove={canApprove}
        currentUserId={me?.id ?? null}
        people={people}
        stages={activeStages}
        stageCatalog={stageCatalog}
        docs={documents}
        initialSection={openSection}
        onClose={() => { setOpenId(null); setOpenSection(undefined); }}
        onUpdate={m.update}
        onDelete={m.remove}
      />
      {me?.isAdmin && <DuplicateProjectDialog source={project} actorId={me.id} open={duplicateOpen} onOpenChange={setDuplicateOpen} onCreated={() => { void qc.invalidateQueries({ queryKey: ["projects"] }); }} />}
    </div>
  );
}

function FilesTab({ projectId, canEdit, documents, tasks, onChange }: { projectId: string; canEdit: boolean; documents: Doc[]; tasks: Task[]; onChange: () => unknown }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (busy || !canEdit) return;
    setBusy(true);
    try {
      for (const f of Array.from(e.target.files ?? [])) await uploadDoc(projectId, f);
      toast.success("Uploaded");
    } catch (err) {
      toast.error(errorMessage(err, "Files could not be uploaded."));
    } finally {
      setBusy(false);
      e.target.value = "";
      void qc.invalidateQueries({ queryKey: ["project-activity"] });
      await onChange();
    }
  }
  async function remove(d: Doc) {
    if (!canEdit || removing) return;
    if (!window.confirm(`Delete ${d.name}? Files used in approval history must be retained.`)) return;
    setRemoving(d.id);
    try {
      // Delete metadata first: approval snapshots must never reference a file already removed.
      const { error: recordError, data: deleted } = await supabase.from("documents").delete().eq("id", d.id).eq("project_id", projectId).select("*").single();
      if (recordError) throw recordError;
      if (!deleted) throw new Error("File was not removed. Refresh and check your access.");
      const { error: fileError } = await supabase.storage.from("project-files").remove([d.path]);
      if (fileError) {
        const { error: restoreError } = await supabase.from("documents").insert(deleted);
        if (restoreError) throw new Error("Storage cleanup failed and the file entry could not be restored. Ask an admin to repair it.");
        throw new Error("The stored file could not be deleted. Its entry was re-added under your account.");
      }
      toast.success("File deleted");
    } catch (err) { toast.error(errorMessage(err, "File could not be deleted.")); }
    finally { setRemoving(null); void qc.invalidateQueries({ queryKey: ["project-activity"] }); await onChange(); }
  }
  return (
    <div>
      {canEdit && (
        <label className="mb-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground hover:border-oak focus-within:ring-2 focus-within:ring-ring sm:p-8">
          <Upload className="h-5 w-5 shrink-0" /> {busy ? "Uploading…" : "Upload drawings, renders, BOQs or photos"}
          <input type="file" multiple disabled={busy} className="sr-only" onChange={(e) => void onFile(e)} />
        </label>
      )}
      {documents.length === 0 ? (
        <p className="text-muted-foreground">No files shared yet.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          {documents.map((d) => (
            <div key={d.id} className="flex min-w-0 items-start gap-3 border-b p-3 last:border-0">
              <FileText className="mt-3 h-5 w-5 shrink-0 text-oak" />
              <div className="min-w-0 flex-1">
                <button onClick={() => openDoc(d.path)} className="min-h-11 w-full text-left text-sm font-medium [overflow-wrap:anywhere] hover:text-oak">{d.name}</button>
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{tasks.find((t) => t.id === d.task_id)?.title}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{fmtSize(d.size)}</span><span>{format(parseISO(d.created_at), "d MMM")}</span></div>
              </div>
              {canEdit && <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-muted" disabled={!!removing} onClick={() => void remove(d)} aria-label={`Delete ${d.name}`}><Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" /></button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type ProjectMember = { id: string; user_id: string; access: string; profile: Profile | null };

function TeamTab({ projectId, members, onChange }: { projectId: string; members: ProjectMember[]; onChange: () => unknown }) {
  const { data: all, isPending, error, refetch } = useQuery({
    queryKey: ["all-profiles"],
    queryFn: async () => {
      const result = await supabase.from("profiles").select("*").order("full_name");
      if (result.error) throw result.error;
      return result.data ?? [];
    },
  });
  const [userId, setUserId] = useState("");
  const [access, setAccess] = useState("client");
  const [busy, setBusy] = useState(false);
  const available = (all ?? []).filter((p) => !members.some((m) => m.user_id === p.id));

  async function add() {
    if (!userId || busy) return;
    setBusy(true);
    try {
      const result = await supabase.from("project_members").insert({ project_id: projectId, user_id: userId, access }).select("id").single();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("Access was not granted.");
      setUserId("");
      toast.success("Project access granted");
      await onChange();
    } catch (err) { toast.error(errorMessage(err, "Access could not be granted.")); }
    finally { setBusy(false); }
  }
  async function remove(mid: string) {
    if (busy || !window.confirm("Remove this person's access to the project?")) return;
    setBusy(true);
    try {
      const result = await supabase.from("project_members").delete().eq("id", mid).eq("project_id", projectId).select("id").single();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("Access was not removed.");
      await onChange();
    } catch (err) { toast.error(errorMessage(err, "Access could not be removed.")); }
    finally { setBusy(false); }
  }
  async function change(mid: string, a: string) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await supabase.from("project_members").update({ access: a }).eq("id", mid).eq("project_id", projectId).select("id").single();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("Access was not changed.");
      await onChange();
    } catch (err) { toast.error(errorMessage(err, "Access could not be changed.")); }
    finally { setBusy(false); }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-muted-foreground">
        <b>Partners</b> can edit items and upload files. <b>Clients</b> can view, comment, and respond to approval requests. Admins always have full access.
      </p>
      {isPending && <p className="text-sm text-muted-foreground">Loading people…</p>}
      {error && <div><p role="alert" className="text-sm text-destructive">{errorMessage(error, "People could not be loaded.")}</p><Button variant="outline" size="sm" onClick={() => void refetch()}>Retry</Button></div>}
      <div className="flex min-w-0 flex-wrap gap-2">
        <Select disabled={busy || isPending || !!error} value={userId} onValueChange={setUserId}>
          <SelectTrigger className="w-full sm:w-64"><SelectValue placeholder="Choose a person" /></SelectTrigger>
          <SelectContent>{available.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name ?? p.email}</SelectItem>)}</SelectContent>
        </Select>
        <Select disabled={busy} value={access} onValueChange={setAccess}>
          <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="client">Client</SelectItem><SelectItem value="partner">Partner</SelectItem></SelectContent>
        </Select>
        <Button className="w-full sm:w-auto" disabled={busy || !userId || !!error} onClick={() => void add()}>Give access</Button>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        {members.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nobody has been added yet.</p>}
        {members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-2 border-b p-3 last:border-0">
            <div className="min-w-0 basis-full [overflow-wrap:anywhere] sm:flex-1 sm:basis-0">
              <p className="text-sm font-medium">{m.profile?.full_name}</p>
              <p className="text-xs text-muted-foreground">{m.profile?.email}</p>
            </div>
            <select aria-label={`Project access for ${m.profile?.full_name ?? m.profile?.email ?? "member"}`} disabled={busy} className="min-h-11 min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-base sm:flex-none" value={m.access} onChange={(e) => void change(m.id, e.target.value)}>
              <option value="client">Client</option>
              <option value="partner">Partner</option>
            </select>
            <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-muted" disabled={busy} onClick={() => void remove(m.id)} aria-label={`Remove ${m.profile?.full_name ?? "member"}`}><Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
