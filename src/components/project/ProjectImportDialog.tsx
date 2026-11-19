import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PROJECT_TYPES, stageLabel } from "@/lib/constants";
import { buildProjectImport, defaultImportProject, parseProjectImport, projectImportResultSchema, type ImportProjectFields, type ProjectImportPlan, type ProjectImportResult } from "@/lib/project-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function ProjectImportDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<ProjectImportPlan | null>(null);
  const [project, setProject] = useState<ImportProjectFields | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProjectImportResult | null>(null);
  const [backendRef, setBackendRef] = useState("");
  const [destinationConfirmed, setDestinationConfirmed] = useState(false);
  const readingVersion = useRef(0);
  const submitting = useRef(false);

  async function chooseFile(file: File | undefined) {
    const version = ++readingVersion.current;
    setPlan(null); setProject(null); setError(""); setResult(null); setDestinationConfirmed(false); setReading(false);
    if (!file) return;
    if (file.size > 2_000_000) { setError("Choose an import JSON smaller than 2 MB."); return; }
    setReading(true);
    try {
      const backendUrl = import.meta.env["VITE_SUPABASE_URL"];
      if (!backendUrl) throw new Error("The app backend is not configured.");
      const currentRef = new URL(backendUrl).hostname.split(".")[0];
      if (!currentRef) throw new Error("The app backend URL has no project reference.");
      const parsed = parseProjectImport(await file.text(), currentRef, true);
      if (version !== readingVersion.current) return;
      setPlan(parsed); setProject(defaultImportProject(parsed)); setBackendRef(currentRef);
    } catch (failure) {
      if (version === readingVersion.current) setError(failure instanceof Error ? failure.message : "Could not read the selected file.");
    } finally {
      if (version === readingVersion.current) setReading(false);
    }
  }

  async function importPlan(event: React.FormEvent) {
    event.preventDefault();
    if (!plan || !project || submitting.current || result) return;
    if (plan.target_backend_ref !== backendRef && !destinationConfirmed) { setError("Confirm the configured destination before importing this migrated plan."); return; }
    submitting.current = true; setBusy(true); setError("");
    try {
      const payload = buildProjectImport(plan, project);
      const { data, error: importError } = await supabase.rpc("import_project_plan", payload);
      if (importError) throw importError;
      setResult(projectImportResultSchema.parse(data));
      void qc.invalidateQueries({ queryKey: ["projects"] });
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : (failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "Import failed.");
      setError(`${message} You can retry the same plan safely; a completed import will open the existing project.`);
    } finally { submitting.current = false; setBusy(false); }
  }

  function update(key: keyof ImportProjectFields, value: string) {
    setProject((current) => current ? { ...current, [key]: value } : current);
  }

  return (
    <Dialog open={open} onOpenChange={(value) => {
      if (submitting.current) return;
      if (value && result) { setResult(null); setPlan(null); setProject(null); setError(""); }
      setOpen(value);
    }}>
      <DialogTrigger asChild><Button variant="outline"><Upload className="h-4 w-4" /> Import project plan</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import project plan</DialogTitle>
          <DialogDescription>Choose the prepared project JSON, review its details, then create the project and its planned approvals.</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-4" role="status">
            <p>{result.created ? "Project imported." : "This plan was already imported. The existing project has been kept without changing later edits."}</p>
            <p className="text-sm">{result.task_count} tasks and {result.approval_plan_count} planned approval records.</p>
            <p className="text-sm">{result.client_linked ? "The existing client account has been added to this project." : "Client access is pending. Create or confirm the client account in People, then add that person as a client in the project’s Team tab."}</p>
            <p className="text-sm text-muted-foreground">Add delivery partners in Team and assign tasks before work begins.</p>
            <Button asChild><Link to="/projects/$id" params={{ id: result.project_id }} onClick={() => setOpen(false)}>Open project</Link></Button>
          </div>
        ) : (
          <form onSubmit={importPlan} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="project-plan-file">Prepared JSON file</Label>
              <Input id="project-plan-file" type="file" accept=".json,application/json" disabled={busy} onChange={(event) => void chooseFile(event.target.files?.[0])} />
              {reading && <p className="text-sm" role="status">Reading file…</p>}
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {plan && project && (
              <>
                <div className="space-y-2 border-y py-3 text-sm">
                  <p>{plan.tasks.length} tasks · {plan.planned_approval_records.length} planned approvals · {plan.tasks.filter((row) => row.proposed_task.start_date).length} dated starts</p>
                  <p>Destination backend: <code>{backendRef}</code></p>
                  <p>All tasks remain not started and unassigned. Planned approvals have no client decision recorded.</p>
                  <p>{plan.tasks.filter((row) => !row.proposed_task.due_date).length} tasks have no due date.</p>
                  <p className="text-muted-foreground">{plan.project_metadata.project_name_status}. Confirm the project name below.</p>
                  {plan.tasks.filter((row) => row.original.start_date && !row.proposed_task.start_date).map((row) => (
                    <p key={row.source_id} className="text-destructive">Task {row.source_id}: “{row.original.start_date}” has no calendar date. Its start date will stay blank until you confirm it in the project.</p>
                  ))}
                </div>
                {plan.target_backend_ref !== backendRef && <div className="space-y-2 rounded-md border p-3 text-sm"><p>This file was prepared for backend <code>{plan.target_backend_ref}</code>. Import will use this app’s configured backend <code>{backendRef}</code>.</p><label className="flex items-start gap-2"><input type="checkbox" disabled={busy} checked={destinationConfirmed} onChange={(event) => setDestinationConfirmed(event.target.checked)} /><span>I confirm this is the intended destination for the migrated project.</span></label></div>}
                <fieldset disabled={busy} className="space-y-3">
                  <div className="space-y-1.5"><Label htmlFor="import-project-name">Project name</Label><Input id="import-project-name" required maxLength={200} value={project.name} onChange={(event) => update("name", event.target.value)} /></div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="import-client-brand" label="Client brand" value={project.client_brand} onChange={(value) => update("client_brand", value)} />
                    <Field id="import-client-name" label="Client contact" value={project.client_name} onChange={(value) => update("client_name", value)} />
                    <Field id="import-client-email" label="Client email" type="email" value={project.client_email} onChange={(value) => update("client_email", value)} />
                    <Field id="import-location" label="Location" value={project.location} onChange={(value) => update("location", value)} />
                    <div className="space-y-1.5"><Label htmlFor="import-project-type">Project type</Label><select id="import-project-type" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={project.project_type} onChange={(event) => update("project_type", event.target.value)}>{PROJECT_TYPES.map((type) => <option key={type}>{type}</option>)}</select></div>
                    <Field id="import-meeting-url" label="Calendly booking link (optional)" type="url" value={project.meeting_url} onChange={(value) => update("meeting_url", value)} />
                    <Field id="import-start-date" label="Project start (optional)" type="date" value={project.start_date} onChange={(value) => update("start_date", value)} />
                    <Field id="import-target-date" label="Target handover (optional)" type="date" value={project.target_date} onChange={(value) => update("target_date", value)} />
                  </div>
                  <div className="space-y-1.5"><Label htmlFor="import-project-notes">Additional project notes</Label><Textarea id="import-project-notes" value={project.description} onChange={(event) => update("description", event.target.value)} /></div>
                </fieldset>
                <details className="text-sm">
                  <summary className="cursor-pointer">Review tasks and source notes</summary>
                  <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2 pr-3">ID</th><th className="py-2 pr-3">Task</th><th className="py-2 pr-3">Stage</th><th className="py-2">Start</th></tr></thead><tbody>{plan.tasks.map((row) => <tr key={row.source_id} className="border-b"><td className="py-2 pr-3">{row.source_id}</td><td className="py-2 pr-3">{row.proposed_task.title}<p className="text-xs text-muted-foreground">{row.proposed_task.description}</p></td><td className="py-2 pr-3">{stageLabel(row.proposed_task.stage)}</td><td className="whitespace-nowrap py-2">{row.proposed_task.start_date ?? "Unscheduled"}</td></tr>)}</tbody></table></div>
                  <p className="mt-3">Workbook notes will be kept for review:</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">{plan.workbook_workflow_notes.items.map((item) => <li key={`${item.source_sheet}:${item.source_cell}`}>{item.text}</li>)}</ul>
                  <p className="mt-3">{plan.overview_material_selection_note.text}: {plan.overview_material_selection_note.note}</p>
                </details>
                <p className="text-sm text-muted-foreground">No starter tasks or new accounts will be created. Importing this source again with the same project name, client email and location opens the existing project.</p>
                <Button type="submit" disabled={busy || reading || (plan.target_backend_ref !== backendRef && !destinationConfirmed)}>{busy ? "Importing…" : "Import project"}</Button>
              </>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ id, label, value, onChange, type = "text" }: { id: string; label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}
