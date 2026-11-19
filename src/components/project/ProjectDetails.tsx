import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { PROJECT_TYPES } from "@/lib/constants";
import { importProjectFieldsSchema, type ImportProjectFields } from "@/lib/project-import";
import { normalizeMeetingUrl } from "@/lib/meeting-url";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Project = Database["public"]["Tables"]["projects"]["Row"];

function projectFields(project: Project): ImportProjectFields {
  return {
    name: project.name, client_name: project.client_name ?? "", client_brand: project.client_brand ?? "",
    client_email: project.client_email ?? "", location: project.location ?? "", project_type: project.project_type,
    description: project.description ?? "", start_date: project.start_date ?? "", target_date: project.target_date ?? "",
    meeting_url: project.meeting_url ?? "",
  };
}

export function ProjectDetails({ project, canEdit, onChange }: {
  project: Project;
  canEdit: boolean;
  onChange: () => unknown;
}) {
  const serverFields = projectFields(project);
  const serverKey = JSON.stringify(serverFields);
  const [form, setForm] = useState<ImportProjectFields>(() => serverFields);
  const [baseKey, setBaseKey] = useState(serverKey);
  const dirty = JSON.stringify(form) !== baseKey;
  const conflict = dirty && serverKey !== baseKey;
  useEffect(() => {
    if (!dirty && baseKey !== serverKey) {
      setForm(JSON.parse(serverKey) as ImportProjectFields);
      setBaseKey(serverKey);
    }
  }, [dirty, baseKey, serverKey]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = (key: keyof ImportProjectFields) => (e: { target: { value: string } }) => setForm((old) => ({ ...old, [key]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !canEdit || conflict || !dirty) return;
    setError(null);
    const parsed = importProjectFieldsSchema.safeParse(form);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the project details."); return; }
    setBusy(true);
    try {
      const input = parsed.data;
      const base = JSON.parse(baseKey) as ImportProjectFields;
      const changes: Database["public"]["Tables"]["projects"]["Update"] = {};
      const changedKeys = (Object.keys(input) as (keyof ImportProjectFields)[]).filter((key) => input[key] !== base[key]);
      if (!changedKeys.length) { setForm(input); return; }
      for (const key of changedKeys) {
        Object.assign(changes, { [key]: key === "meeting_url" ? normalizeMeetingUrl(input[key]) : input[key] || null });
      }
      let query = supabase.from("projects").update(changes).eq("id", project.id);
      // Compare changed fields with their original values so a concurrent edit cannot be overwritten.
      for (const key of changedKeys) {
        const original = project[key];
        query = original === null ? query.is(key, null) : query.eq(key, original);
      }
      const { error: savedError, data } = await query.select("*").single();
      if (savedError) throw savedError;
      if (!data) throw new Error("Project was not saved. Refresh and check for changes or access updates.");
      await onChange();
      const savedFields = projectFields(data);
      setForm(savedFields);
      setBaseKey(JSON.stringify(savedFields));
      toast.success("Project details saved");
    } catch (err) { setError(errorMessage(err, "Project details could not be saved.")); }
    finally { setBusy(false); }
  }

  const field = (label: string, key: keyof ImportProjectFields, type = "text") => (
    <div className="space-y-1.5">
      <Label htmlFor={`project-${key}`}>{label}</Label>
      <Input id={`project-${key}`} type={type} value={form[key]} onChange={change(key)} />
    </div>
  );
  return (
    <form onSubmit={save} className="max-w-2xl space-y-4">
      <fieldset disabled={!canEdit || busy} className="space-y-4">
        {field("Project name", "name")}
        <div className="grid gap-4 sm:grid-cols-2">
          {field("Client brand", "client_brand")}{field("Client contact", "client_name")}
          {field("Client email", "client_email", "email")}{field("Site / location", "location")}
          {field("Start date", "start_date", "date")}{field("Target handover", "target_date", "date")}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="project-type">Project type</Label>
          <select id="project-type" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.project_type} onChange={change("project_type")}>
            {PROJECT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>
        {field("Calendly booking link", "meeting_url", "url")}
        <p className="text-sm text-muted-foreground">Add the booking link to show “Schedule a meeting” on this project.</p>
        <div className="space-y-1.5">
          <Label htmlFor="project-description">Project notes</Label>
          <Textarea id="project-description" rows={5} value={form.description} onChange={change("description")} />
        </div>
      </fieldset>
      <p className="text-sm text-muted-foreground">Contact details do not grant portal access. An admin manages access in the Team tab.</p>
      {conflict && <div role="alert" className="space-y-2 text-sm">
        <p>Project details changed while you were editing. Load the latest details before saving.</p>
        <Button type="button" variant="outline" onClick={() => { setForm(serverFields); setBaseKey(serverKey); setError(null); }}>Load latest details</Button>
      </div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {canEdit && <Button type="submit" disabled={busy || conflict || !dirty}>{busy ? "Saving…" : "Save details"}</Button>}
    </form>
  );
}
