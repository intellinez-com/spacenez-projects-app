import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { ZodError } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { PROJECT_TYPES, STAGES, stageLabel } from "@/lib/constants";
import {
  buildProjectImport,
  defaultImportProject,
  parseProjectImport,
  projectImportResultSchema,
  type ImportProjectFields,
  type ProjectImportPlan,
  type ProjectImportResult,
} from "@/lib/project-import";
import {
  PROJECT_PLAN_FILE_ACCEPT,
  PROJECT_PLAN_FILE_MAX_BYTES,
  createProjectPlanTemplate,
  parseProjectPlanFile,
} from "@/lib/project-plan-file";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type ImportPayload = ReturnType<typeof buildProjectImport>;
type SourceKind = "spreadsheet" | "json";
function message(error: unknown) {
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Check the project details.";
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return "The project plan could not be imported.";
}

export function ProjectImportDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<ProjectImportPlan | null>(null);
  const [project, setProject] = useState<ImportProjectFields | null>(null);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [unmappedStages, setUnmappedStages] = useState<string[]>([]);
  const [stageMapping, setStageMapping] = useState<Record<string, string>>({});
  const [sourceKind, setSourceKind] = useState<SourceKind>("spreadsheet");
  const [filename, setFilename] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attemptLocked, setAttemptLocked] = useState(false);
  const [result, setResult] = useState<ProjectImportResult | null>(null);
  const [backendRef, setBackendRef] = useState("");
  const [destinationConfirmed, setDestinationConfirmed] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const readingVersion = useRef(0);
  const submitting = useRef(false);
  const attemptedPayload = useRef<ImportPayload | null>(null);
  const locked = busy || attemptLocked;
  const previewOnly = import.meta.env.MODE === "client-preview";
  const mismatch = sourceKind === "json" && !!plan && plan.target_backend_ref !== backendRef;
  const selectedStage = (name: string) => {
    const value = Object.hasOwn(stageMapping, name) ? stageMapping[name] : undefined;
    return STAGES.some((stage) => stage.key === value) ? value : undefined;
  };
  const mappingsRequired = unmappedStages.some((name) => !selectedStage(name));
  const mappedPlan = useMemo(() => {
    if (!plan) return null;
    return {
      ...plan,
      tasks: plan.tasks.map((row) => {
        const mapped = Object.hasOwn(stageMapping, row.original.stage)
          ? stageMapping[row.original.stage]
          : undefined;
        if (!mapped || !STAGES.some((stage) => stage.key === mapped)) return row;
        return {
          ...row,
          proposed_task: { ...row.proposed_task, stage: mapped },
          mapping_notes: [
            ...row.mapping_notes,
            `Admin mapped ${row.original.stage} to ${stageLabel(mapped)}.`,
          ],
        };
      }),
    };
  }, [plan, stageMapping]);

  function reset() {
    readingVersion.current++;
    attemptedPayload.current = null;
    setPlan(null);
    setProject(null);
    setError("");
    setResult(null);
    setWarnings([]);
    setUnmappedStages([]);
    setStageMapping({});
    setFilename("");
    setReading(false);
    setAttemptLocked(false);
    setDestinationConfirmed(false);
    setReviewOpen(false);
  }

  async function chooseFile(file: File | undefined, kind: SourceKind) {
    if (submitting.current || attemptedPayload.current) return;
    const version = ++readingVersion.current;
    setPlan(null);
    setProject(null);
    setError("");
    setResult(null);
    setWarnings([]);
    setUnmappedStages([]);
    setStageMapping({});
    setDestinationConfirmed(false);
    setReviewOpen(false);
    setReading(false);
    setFilename(file?.name ?? "");
    setSourceKind(kind);
    if (!file) return;
    const limit = kind === "json" ? 2_000_000 : PROJECT_PLAN_FILE_MAX_BYTES;
    if (file.size > limit) {
      setError(
        kind === "json"
          ? "Choose an import JSON smaller than 2 MB."
          : "Choose an Excel or CSV plan up to 5 MB.",
      );
      return;
    }
    setReading(true);
    try {
      const backendUrl = import.meta.env["VITE_SUPABASE_URL"];
      if (!backendUrl)
        throw new Error(
          "The portal connection is not configured. Please contact your administrator.",
        );
      const currentRef = new URL(backendUrl).hostname.split(".")[0];
      if (!currentRef) throw new Error("The portal connection is not configured.");
      const parsed =
        kind === "json"
          ? {
              plan: parseProjectImport(await file.text(), currentRef, true),
              warnings: [],
              unmappedStages: [],
            }
          : await parseProjectPlanFile(file, currentRef);
      if (version !== readingVersion.current) return;
      setPlan(parsed.plan);
      setProject(defaultImportProject(parsed.plan));
      setBackendRef(currentRef);
      setWarnings(parsed.warnings);
      setUnmappedStages(parsed.unmappedStages);
    } catch (failure) {
      if (version === readingVersion.current) setError(message(failure));
    } finally {
      if (version === readingVersion.current) setReading(false);
    }
  }

  function downloadTemplate() {
    try {
      const template = createProjectPlanTemplate();
      const url = URL.createObjectURL(new Blob([template.contents], { type: template.mime }));
      const revoke = URL.revokeObjectURL.bind(URL);
      const link = document.createElement("a");
      link.href = url;
      link.download = template.filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => revoke(url), 1000);
    } catch {
      setError("The template could not be downloaded. Please try again.");
    }
  }

  async function importPlan(event: React.FormEvent) {
    event.preventDefault();
    if (!mappedPlan || !project || submitting.current || result || reading || previewOnly) return;
    if (!attemptedPayload.current && mappingsRequired) {
      setError("Choose an app stage for each unrecognised spreadsheet stage.");
      return;
    }
    if (!attemptedPayload.current && mismatch && !destinationConfirmed) {
      setError("Confirm the configured destination before importing this migrated plan.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const payload = attemptedPayload.current ?? buildProjectImport(mappedPlan, project);
      attemptedPayload.current = payload;
      setAttemptLocked(true);
      const { data, error: importError } = await supabase.rpc("import_project_plan", payload);
      if (importError) throw importError;
      setResult(projectImportResultSchema.parse(data));
      void qc.invalidateQueries({ queryKey: ["projects"] });
    } catch (failure) {
      setError(
        attemptedPayload.current
          ? `${message(failure)} Retry this same import without changing its details. If it already finished, the existing project will open.`
          : message(failure),
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function update(key: keyof ImportProjectFields, value: string) {
    if (submitting.current || attemptedPayload.current) return;
    setProject((current) => (current ? { ...current, [key]: value } : current));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (submitting.current) return;
        if (!value) {
          readingVersion.current++;
          if (reading && !plan) setFilename("");
          setReading(false);
        }
        if (value && result) reset();
        setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full sm:w-auto">
          <Upload className="h-4 w-4" /> Import project plan
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] min-w-0 max-w-3xl overflow-y-auto [overflow-wrap:anywhere]">
        <DialogHeader>
          <DialogTitle>Import project plan</DialogTitle>
          <DialogDescription>
            Upload an Excel or CSV plan, review the tasks and dates, then create the project. Use
            the template if you are starting a new plan.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="min-w-0 space-y-4" role="status">
            <p>
              {result.created
                ? "Project imported."
                : "This plan was already imported. The existing project has been kept without changing later edits."}
            </p>
            <p className="text-sm">
              {result.task_count} tasks and {result.approval_plan_count} planned approval records.
            </p>
            <p className="text-sm">
              {result.client_linked
                ? "The existing client account has been added to this project."
                : "Client access is pending. Create or confirm the client account in People, then add that person as a client in the project’s Team tab."}
            </p>
            <p className="text-sm text-muted-foreground">
              Add delivery partners in Team and assign tasks before work begins.
            </p>
            <Button asChild className="w-full sm:w-auto">
              <Link
                to="/projects/$id"
                params={{ id: result.project_id }}
                onClick={() => setOpen(false)}
              >
                Open project
              </Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={importPlan} className="min-w-0 space-y-5">
            <div className="min-w-0 space-y-3">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full whitespace-normal sm:w-auto"
                onClick={downloadTemplate}
              >
                <Download className="h-4 w-4" /> Download spreadsheet template
              </Button>
              <p className="text-sm text-muted-foreground">
                Open the template in Excel. Fill in Stage and Task, then add dates and other details
                if known. Existing project workbooks can also be uploaded.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="project-plan-spreadsheet">Excel or CSV plan</Label>
                <Input
                  id="project-plan-spreadsheet"
                  type="file"
                  accept={PROJECT_PLAN_FILE_ACCEPT}
                  disabled={locked}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void chooseFile(file, "spreadsheet");
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                .xlsx or .csv, up to 5 MB. This creates a new plan; it does not update an existing
                project’s progress.
              </p>
              <details className="text-sm">
                <summary className="cursor-pointer py-2">How stages work</summary>
                <p className="mt-2">
                  The portal uses these standard stages. Match each row to one of them; you can add,
                  edit or remove tasks inside a stage after import.
                </p>
                <p className="mt-2 text-muted-foreground">
                  {STAGES.map((stage) => stage.label).join(" · ")}
                </p>
              </details>
              <details className="min-w-0 text-sm">
                <summary className="cursor-pointer py-2">Advanced: prepared JSON</summary>
                <div className="mt-2 space-y-2">
                  <p className="text-muted-foreground">
                    For plans already prepared by technical support. Normal spreadsheet imports do
                    not need JSON.
                  </p>
                  <Label htmlFor="project-plan-file">Prepared JSON file</Label>
                  <Input
                    id="project-plan-file"
                    type="file"
                    accept=".json,application/json"
                    disabled={locked}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      void chooseFile(file, "json");
                    }}
                  />
                </div>
              </details>
              {filename && (
                <p className="text-sm">
                  Selected plan: <strong>{filename}</strong>
                </p>
              )}
              {reading && (
                <p className="text-sm" role="status">
                  Reading file…
                </p>
              )}
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {plan && project && mappedPlan && (
              <>
                <div className="space-y-2 border-y py-3 text-sm">
                  <h3 className="font-medium">Review before importing</h3>
                  <p>
                    {plan.tasks.length} tasks · {plan.planned_approval_records.length} planned
                    approvals · {plan.tasks.filter((row) => row.proposed_task.start_date).length}{" "}
                    dated starts
                  </p>
                  <p>
                    All tasks will start as not started and unassigned. Planned approvals have no
                    client decision recorded.
                  </p>
                  <p>
                    {plan.tasks.filter((row) => !row.proposed_task.due_date).length} tasks have no
                    due date.
                  </p>
                  <p className="text-muted-foreground">
                    Confirm the project name, client and location below. Client access is managed
                    through People and Team.
                  </p>
                  {sourceKind === "json" && (
                    <details>
                      <summary className="cursor-pointer py-1">Advanced source details</summary>
                      <p>
                        Destination backend: <code>{backendRef}</code>
                      </p>
                      <p>{plan.project_metadata.project_name_status}</p>
                    </details>
                  )}
                </div>
                {warnings.length > 0 && (
                  <section className="space-y-2 text-sm" aria-label="Spreadsheet review notes">
                    <h3 className="font-medium">Review notes</h3>
                    <ul className="list-disc space-y-1 pl-5">
                      {warnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {plan.tasks.flatMap((row) =>
                  (["start_date", "due_date"] as const).flatMap((field) =>
                    row.original[field] && !row.proposed_task[field]
                      ? [
                          <p key={`${row.source_id}:${field}`} className="text-sm text-destructive">
                            Task {row.source_id}: “{row.original[field]}” has no calendar date. Its{" "}
                            {field === "start_date" ? "start" : "due"} date will stay blank. Correct
                            the spreadsheet before importing if a date is required.
                          </p>,
                        ]
                      : [],
                  ),
                )}
                {unmappedStages.length > 0 && (
                  <fieldset
                    disabled={locked}
                    className="min-w-0 space-y-3 rounded-md border p-3 text-sm"
                  >
                    <legend className="px-1 font-medium">Match spreadsheet stages</legend>
                    <p>
                      Choose where these tasks belong. No tasks will be placed into an unrecognised
                      stage.
                    </p>
                    {unmappedStages.map((name, index) => (
                      <div key={name} className="space-y-1.5">
                        <Label htmlFor={`map-import-stage-${index}`}>Map stage “{name}”</Label>
                        <select
                          id={`map-import-stage-${index}`}
                          className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-base md:text-sm"
                          value={selectedStage(name) ?? ""}
                          onChange={(event) => {
                            if (!attemptedPayload.current && !submitting.current)
                              setStageMapping((current) => ({
                                ...current,
                                [name]: event.target.value,
                              }));
                          }}
                        >
                          <option value="">Choose an app stage</option>
                          {STAGES.map((stage) => (
                            <option key={stage.key} value={stage.key}>
                              {stage.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </fieldset>
                )}
                {mismatch && (
                  <div className="space-y-2 rounded-md border p-3 text-sm">
                    <p>
                      This prepared JSON targets backend <code>{plan.target_backend_ref}</code>.
                      This portal uses <code>{backendRef}</code>.
                    </p>
                    <label className="flex min-h-11 items-start gap-2">
                      <input
                        type="checkbox"
                        disabled={locked}
                        checked={destinationConfirmed}
                        onChange={(event) => {
                          if (!attemptedPayload.current)
                            setDestinationConfirmed(event.target.checked);
                        }}
                      />
                      <span>
                        I confirm this is the intended destination for the migrated project.
                      </span>
                    </label>
                  </div>
                )}
                <fieldset disabled={locked} className="min-w-0 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="import-project-name">Project name</Label>
                    <Input
                      id="import-project-name"
                      required
                      maxLength={200}
                      value={project.name}
                      onChange={(event) => update("name", event.target.value)}
                    />
                  </div>
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                    <Field
                      id="import-client-brand"
                      label="Client brand"
                      value={project.client_brand}
                      onChange={(value) => update("client_brand", value)}
                    />
                    <Field
                      id="import-client-name"
                      label="Client contact"
                      value={project.client_name}
                      onChange={(value) => update("client_name", value)}
                    />
                    <Field
                      id="import-client-email"
                      label="Client email"
                      type="email"
                      value={project.client_email}
                      onChange={(value) => update("client_email", value)}
                    />
                    <Field
                      id="import-location"
                      label="Location"
                      value={project.location}
                      onChange={(value) => update("location", value)}
                    />
                    <div className="space-y-1.5">
                      <Label htmlFor="import-project-type">Project type</Label>
                      <select
                        id="import-project-type"
                        className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-base md:text-sm"
                        value={project.project_type}
                        onChange={(event) => update("project_type", event.target.value)}
                      >
                        {PROJECT_TYPES.map((type) => (
                          <option key={type}>{type}</option>
                        ))}
                      </select>
                    </div>
                    <Field
                      id="import-meeting-url"
                      label="Calendly booking link (optional)"
                      type="url"
                      value={project.meeting_url}
                      onChange={(value) => update("meeting_url", value)}
                    />
                    <Field
                      id="import-start-date"
                      label="Project start (optional)"
                      type="date"
                      value={project.start_date}
                      onChange={(value) => update("start_date", value)}
                    />
                    <Field
                      id="import-target-date"
                      label="Target handover (optional)"
                      type="date"
                      value={project.target_date}
                      onChange={(value) => update("target_date", value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="import-project-notes">Additional project notes</Label>
                    <Textarea
                      id="import-project-notes"
                      value={project.description}
                      onChange={(event) => update("description", event.target.value)}
                    />
                  </div>
                </fieldset>
                <details
                  className="min-w-0 text-sm"
                  open={reviewOpen}
                  onToggle={(event) => setReviewOpen(event.currentTarget.open)}
                >
                  <summary className="cursor-pointer py-2">Review tasks and source notes</summary>
                  {reviewOpen && (
                    <>
                      <div
                        role="region"
                        aria-label="Import task preview"
                        tabIndex={0}
                        className="mt-3 min-w-0 overflow-x-auto"
                      >
                        <table className="w-full min-w-[760px] text-left text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="py-2 pr-3">Task</th>
                              <th className="py-2 pr-3">Stage</th>
                              <th className="py-2 pr-3">Start</th>
                              <th className="py-2 pr-3">Due</th>
                              <th className="py-2">Owner from sheet</th>
                            </tr>
                          </thead>
                          <tbody>
                            {mappedPlan.tasks.map((row) => (
                              <tr key={row.source_id} className="border-b">
                                <td className="min-w-48 max-w-sm py-2 pr-3">
                                  {row.proposed_task.title}
                                  <p className="text-xs text-muted-foreground">
                                    {row.proposed_task.description}
                                  </p>
                                </td>
                                <td className="min-w-32 py-2 pr-3">
                                  {unmappedStages.includes(row.original.stage) &&
                                  !selectedStage(row.original.stage)
                                    ? "Choose stage above"
                                    : stageLabel(row.proposed_task.stage)}
                                  <p className="text-xs text-muted-foreground">
                                    From: {row.original.stage}
                                  </p>
                                </td>
                                <td className="whitespace-nowrap py-2 pr-3">
                                  {row.proposed_task.start_date ?? "Unscheduled"}
                                </td>
                                <td className="whitespace-nowrap py-2 pr-3">
                                  {row.proposed_task.due_date ?? "Unscheduled"}
                                </td>
                                <td className="min-w-32 py-2">
                                  {row.original.responsible || "Not supplied"}
                                  <p className="text-xs text-muted-foreground">
                                    Assign in project after import
                                  </p>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-3">Workbook notes will be kept for review:</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {plan.workbook_workflow_notes.items.map((item, index) => (
                          <li key={index}>{item.text}</li>
                        ))}
                      </ul>
                      {plan.overview_material_selection_note.text && (
                        <p className="mt-3">
                          {plan.overview_material_selection_note.text}:{" "}
                          {plan.overview_material_selection_note.note}
                        </p>
                      )}
                    </>
                  )}
                </details>
                <p className="text-sm text-muted-foreground">
                  Only the listed tasks and planned approvals will be created. This does not create
                  user accounts or record past work as completed.
                </p>
                {attemptLocked && !busy && (
                  <div className="space-y-2 border-t pt-3 text-sm">
                    <p>
                      Import details are kept fixed for a safe retry. Check the project list before
                      starting a different import.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 w-full whitespace-normal sm:w-auto"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Check Projects for an import that may already have finished. Start a different import now?",
                          )
                        )
                          reset();
                      }}
                    >
                      Start a different import
                    </Button>
                  </div>
                )}
                {previewOnly && (
                  <p className="text-sm text-muted-foreground">
                    Local review only. Project creation is disabled in this demo.
                  </p>
                )}
                <Button
                  type="submit"
                  className="min-h-11 w-full sm:w-auto"
                  disabled={
                    previewOnly ||
                    busy ||
                    reading ||
                    mappingsRequired ||
                    (mismatch && !destinationConfirmed)
                  }
                >
                  {busy ? "Importing…" : "Import project"}
                </Button>
              </>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        className="min-w-0"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
