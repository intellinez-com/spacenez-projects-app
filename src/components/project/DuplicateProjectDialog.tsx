import { useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PROJECT_TYPES } from "@/lib/constants";
import { errorMessage } from "@/lib/errors";
import {
  buildDuplicateProjectRequest, clearPendingDuplicate, defaultDuplicateProjectFields, duplicateProjectFieldsSchema,
  duplicateProjectResultSchema, keepPendingDuplicate, readPendingDuplicate,
  type DuplicateProjectFields, type DuplicateProjectRequest, type DuplicateProjectResult, type DuplicateProjectSource,
} from "@/lib/project-duplicate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type DuplicateProjectDialogProps = {
  source: DuplicateProjectSource;
  actorId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (result: DuplicateProjectResult) => void;
};

export function DuplicateProjectDialog(props: DuplicateProjectDialogProps) {
  return <DuplicateProjectForm key={`${props.actorId}:${props.source.id}`} {...props} />;
}

function DuplicateProjectForm({ source, actorId, open, onOpenChange, onCreated }: DuplicateProjectDialogProps) {
  const qc = useQueryClient();
  const formId = useId();
  const [pending, setPending] = useState<DuplicateProjectRequest | null>(() => readPendingDuplicate(actorId, source.id));
  const [fields, setFields] = useState<DuplicateProjectFields>(() => readPendingDuplicate(actorId, source.id)?.p_project ?? defaultDuplicateProjectFields(source));
  const [requestId, setRequestId] = useState(() => readPendingDuplicate(actorId, source.id)?.p_request_id ?? crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DuplicateProjectResult | null>(null);
  const submitting = useRef(false);
  const locked = busy || !!pending;

  function update(key: keyof DuplicateProjectFields, value: string) {
    if (!locked) setFields((previous) => ({ ...previous, [key]: value }));
  }
  function closeDialog(nextOpen: boolean) {
    if (submitting.current) return;
    if (!nextOpen && result) {
      setFields(defaultDuplicateProjectFields(source));
      setRequestId(crypto.randomUUID());
      setResult(null);
      setError("");
    }
    onOpenChange(nextOpen);
  }
  function startDifferentCopy() {
    if (submitting.current) return;
    if (pending && !window.confirm("Check Projects in case the previous copy completed. Start a different copy?")) return;
    clearPendingDuplicate(actorId, source.id);
    setPending(null); setFields(defaultDuplicateProjectFields(source)); setRequestId(crypto.randomUUID()); setResult(null); setError("");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || result) return;
    let request = pending;
    if (!request) {
      const validated = duplicateProjectFieldsSchema.safeParse(fields);
      if (!validated.success) { setError(validated.error.issues[0]?.message ?? "Check the new project details."); return; }
      request = buildDuplicateProjectRequest(source.id, requestId, validated.data);
      setFields(validated.data); setPending(request); keepPendingDuplicate(actorId, request);
    }
    submitting.current = true; setBusy(true); setError("");
    try {
      const response = await supabase.rpc("duplicate_project", request);
      if (response.error) throw response.error;
      const saved = duplicateProjectResultSchema.parse(response.data);
      setResult(saved); setPending(null); clearPendingDuplicate(actorId, source.id);
      void qc.invalidateQueries({ queryKey: ["projects"] });
      onCreated?.(saved);
    } catch (failure) {
      setError(`${errorMessage(failure, "The copy could not be confirmed.")} Retry this request to retrieve a completed copy safely.`);
    } finally { submitting.current = false; setBusy(false); }
  }

  const textField = (key: keyof DuplicateProjectFields, label: string, options: { required?: boolean; type?: string; maxLength?: number } = {}) => <div className="min-w-0 space-y-1.5">
    <Label htmlFor={`${formId}-${key}`}>{label}</Label>
    <Input id={`${formId}-${key}`} name={key} required={options.required} type={options.type ?? "text"} maxLength={options.maxLength} disabled={locked} value={fields[key]} onChange={(event) => update(key, event.target.value)} className="min-h-11 min-w-0" />
  </div>;

  return <Dialog open={open} onOpenChange={closeDialog}>
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] min-w-0 max-w-xl flex-col gap-4 overflow-hidden p-4 [overflow-wrap:anywhere] sm:p-6">
      <DialogHeader className="max-h-[25dvh] shrink-0 overflow-y-auto pr-8 text-left">
        <DialogTitle>Duplicate project</DialogTitle>
        <DialogDescription>Reuse headings, tasks and planned reviews from {source.name}. The new project starts with fresh progress and its own client and team.</DialogDescription>
      </DialogHeader>
      {result ? <div className="min-h-0 space-y-4 overflow-y-auto">
        <div role="status" className="space-y-2 text-sm">
          <p>{result.created ? "Project duplicated." : "This request already completed. The existing copy is ready."}</p>
          <p>{result.stage_count} headings, {result.task_count} tasks and {result.approval_plan_count} planned reviews.</p>
          <p>Tasks start as Not started and unassigned. Add the new client and delivery team in Team & access.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild className="min-h-11"><Link to="/projects/$id" params={{ id: result.project_id }} onClick={() => closeDialog(false)}>Open project</Link></Button>
          <Button type="button" variant="outline" className="min-h-11" onClick={startDifferentCopy}>Make another copy</Button>
        </div>
      </div> : <form aria-label="Duplicate project details" onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col gap-4">
        <div role="region" aria-label="New project details" className="min-h-0 space-y-4 overflow-y-auto">
          {textField("name", "New project name", { required: true, maxLength: 200 })}
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            {textField("client_name", "Client name", { maxLength: 200 })}
            {textField("client_brand", "Client brand / company", { maxLength: 200 })}
            {textField("client_email", "Client email", { type: "email", maxLength: 320 })}
            {textField("location", "Location", { maxLength: 500 })}
          </div>
          <div className="space-y-1.5"><Label htmlFor={`${formId}-project_type`}>Project type</Label><select id={`${formId}-project_type`} aria-label="Project type" disabled={locked} value={fields.project_type} onChange={(event) => update("project_type", event.target.value)} className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-base sm:text-sm">{PROJECT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></div>
          <div className="space-y-1.5"><Label htmlFor={`${formId}-description`}>New project notes (optional)</Label><Textarea id={`${formId}-description`} disabled={locked} value={fields.description} maxLength={20_000} onChange={(event) => update("description", event.target.value)} rows={3} className="min-h-24 resize-y text-base sm:text-sm" /></div>
          <p className="text-sm text-muted-foreground">Task dates and owners will be blank. Photos, comments, client decisions and payments stay with the original project.</p>
          {pending && <p className="text-sm">These details are held for this request. Retry to retrieve the same copy.</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 border-t pt-3">
          <Button type="submit" className="min-h-11" disabled={busy}>{busy ? "Duplicating..." : pending ? "Retry duplication" : "Create copy"}</Button>
          <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => closeDialog(false)}>Cancel</Button>
          {pending && !busy && <Button type="button" variant="ghost" className="min-h-11" onClick={startDifferentCopy}>Start a different copy</Button>}
        </div>
      </form>}
    </DialogContent>
  </Dialog>;
}
