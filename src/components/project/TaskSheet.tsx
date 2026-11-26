import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { format, formatDistanceToNow, isValid, parseISO } from "date-fns";
import { Paperclip, Trash2, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STAGES, STATUSES, PRIORITIES, stageLabel, statusLabel, type StageDefinition } from "@/lib/constants";
import { type Task, type ProjectPerson, type Doc, uploadDoc, openDoc, fmtSize, errorMessage } from "./data";
import { TaskApprovalPanel } from "./approvals";

type TaskSheetProps = {
  task: Task | null;
  projectId: string;
  canEdit: boolean;
  canApprove: boolean;
  currentUserId: string | null;
  people: ProjectPerson[];
  stages?: readonly StageDefinition[];
  stageCatalog?: readonly StageDefinition[];
  docs: Doc[];
  initialSection?: "comments" | "files" | undefined;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<Task>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export function TaskSheet(props: TaskSheetProps) {
  return props.task ? <TaskSheetContent key={props.task.id} {...props} task={props.task} /> : null;
}

function TaskSheetContent({ task, projectId, canEdit, canApprove, currentUserId, people, docs, initialSection, onClose, onUpdate, onDelete, stages = STAGES, stageCatalog = stages }: Omit<TaskSheetProps, "task"> & { task: Task }) {
  const qc = useQueryClient();
  const commentInput = useRef<HTMLTextAreaElement>(null);
  const filesHeading = useRef<HTMLHeadingElement>(null);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);

  const focusInitialSection = useCallback(() => {
    if (!initialSection) return;
    const target = initialSection === "comments" ? commentInput.current : filesHeading.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: initialSection === "comments" ? "nearest" : "start" });
  }, [initialSection]);

  useEffect(() => {
    // Also follow a new shortcut target while the same task panel remains open.
    const timer = window.setTimeout(focusInitialSection, 0);
    return () => window.clearTimeout(timer);
  }, [focusInitialSection, task.id]);

  const { data: comments, refetch, isPending: commentsPending, isError: commentsFailed, error: commentsError } = useQuery({
    queryKey: ["comments", projectId, task.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("comments")
        .select("*, author:profiles(full_name, email)")
        .eq("task_id", task.id)
        .eq("project_id", projectId)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const taskDocs = docs.filter((d) => d.task_id === task.id);
  const editingDisabled = !canEdit || saving || deleting;
  const assignee = people.find((person) => person.id === task.assignee_id);
  const dateLabel = (value: string | null) => {
    const date = value ? parseISO(value) : null;
    return date && isValid(date) ? format(date, "d MMM yyyy") : "Not set";
  };
  const readOnlyFields = [
    ["Status", statusLabel(task.status)], ["Stage", stageLabel(task.stage, stageCatalog)],
    ["Priority", PRIORITIES.find((priority) => priority.key === task.priority)?.label ?? task.priority],
    ["Owner", task.assignee_id ? assignee?.full_name || assignee?.email || "Assigned team member" : "Unassigned"],
    ["Start", dateLabel(task.start_date)], ["Due", dateLabel(task.due_date)],
  ];

  async function save(patch: Partial<Task>) {
    setSaving(true);
    setSaveError(null);
    try {
      await onUpdate(task.id, patch);
      return true;
    } catch (error) {
      setSaveError(errorMessage(error));
      return false;
    } finally { setSaving(false); }
  }

  async function deleteTask() {
    if (deleting) return;
    setDeleting(true);
    setSaveError(null);
    try {
      await onDelete(task.id);
      onClose();
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally { setDeleting(false); }
  }

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || posting) return;
    setPosting(true);
    setCommentError(null);
    try {
      const { data: u, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!u.user) throw new Error("Your session has expired. Sign in again before posting a comment.");
      const { error } = await supabase.from("comments").insert({ project_id: projectId, task_id: task.id, user_id: u.user.id, body: body.trim() });
      if (error) throw error;
      setBody("");
      void qc.invalidateQueries({ queryKey: ["project-updates", projectId] });
      void qc.invalidateQueries({ queryKey: ["project-activity"] });
      await refetch();
    } catch (error) { setCommentError(errorMessage(error)); }
    finally { setPosting(false); }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length || uploading) return;
    const input = e.currentTarget;
    setUploading(true);
    try {
      for (const f of files) await uploadDoc(projectId, f, task.id);
      toast.success("Uploaded");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
      void qc.invalidateQueries({ queryKey: ["task-approvals", projectId] });
      void qc.invalidateQueries({ queryKey: ["project-activity"] });
      setUploading(false);
      input.value = "";
    }
  }

  const field = (label: string, el: React.ReactNode) => (
    <div className="min-w-0 space-y-1.5"><Label className="text-sm text-muted-foreground">{label}</Label>{el}</div>
  );

  return (
    <Sheet open={!!task} onOpenChange={(o) => !o && onClose()}>
      <SheetContent onOpenAutoFocus={(event) => { if (initialSection) { event.preventDefault(); focusInitialSection(); } }} className="flex h-dvh max-h-dvh w-full max-w-full flex-col gap-0 overflow-hidden px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:max-w-lg sm:px-6 sm:pt-6">
        <SheetHeader className="mb-5 max-h-[30dvh] min-h-11 shrink-0 overflow-y-auto text-left">
          <SheetTitle className="pr-12 text-left [overflow-wrap:anywhere]">{canEdit ? "Task details" : task.title}</SheetTitle>
          <SheetDescription className="sr-only">Review task details, files, client approval and comments.</SheetDescription>
        </SheetHeader>
        <div role="region" aria-label="Task content" className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto overscroll-contain [overflow-wrap:anywhere]">
          {canEdit && <Input
            key={task.id + "t"}
            defaultValue={task.title}
            disabled={editingDisabled}
            aria-label="Task title"
            onBlur={async (e) => {
              const input = e.currentTarget;
              if (input.value === task.title) return;
              if (!input.value.trim()) { input.value = task.title; setSaveError("Enter a task title."); return; }
              const value = input.value.trim();
              input.value = await save({ title: value }) ? value : task.title;
            }}
            className="h-12 min-w-0 border-0 px-0 font-display text-xl shadow-none focus-visible:ring-0 md:text-xl"
          />}
          {canEdit ? <div className="grid min-w-0 grid-cols-1 gap-3 min-[360px]:grid-cols-2">
            {field("Status",
              <Select disabled={editingDisabled} value={task.status} onValueChange={(v) => void save({ status: v })}>
                <SelectTrigger aria-label="Status" className="min-h-11 min-w-0 text-base md:text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
              </Select>)}
            {field("Stage",
              <Select disabled={editingDisabled} value={task.stage} onValueChange={(v) => void save({ stage: v })}>
                <SelectTrigger aria-label="Stage" className="min-h-11 min-w-0 text-base md:text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{!stages.some((stage) => stage.key === task.stage) && <SelectItem value={task.stage} disabled>{stageLabel(task.stage, stageCatalog)} (not active)</SelectItem>}{stages.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
              </Select>)}
            {field("Priority",
              <Select disabled={editingDisabled} value={task.priority} onValueChange={(v) => void save({ priority: v })}>
                <SelectTrigger aria-label="Priority" className="min-h-11 min-w-0 text-base md:text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
              </Select>)}
            {field("Owner",
              <Select disabled={editingDisabled} value={task.assignee_id ?? "none"} onValueChange={(v) => void save({ assignee_id: v === "none" ? null : v })}>
                <SelectTrigger aria-label="Owner" className="min-h-11 min-w-0 text-base md:text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name ?? p.email}</SelectItem>)}
                </SelectContent>
              </Select>)}
            {field("Start", <Input type="date" aria-label="Start date" className="min-h-11 min-w-0" disabled={editingDisabled} value={task.start_date ?? ""} onChange={(e) => void save({ start_date: e.target.value || null })} />)}
            {field("Due", <Input type="date" aria-label="Due date" className="min-h-11 min-w-0" disabled={editingDisabled} value={task.due_date ?? ""} onChange={(e) => void save({ due_date: e.target.value || null })} />)}
          </div> : <dl className="grid min-w-0 grid-cols-1 gap-4 text-sm min-[360px]:grid-cols-2">
            {readOnlyFields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1">{value}</dd></div>)}
          </dl>}
          {field("Description",
            canEdit ? <Textarea
              key={task.id + "d"}
              rows={4}
              aria-label="Task description"
              className="min-h-28 resize-y text-base md:text-sm"
              disabled={editingDisabled}
              defaultValue={task.description ?? ""}
              onBlur={async (e) => {
                const input = e.currentTarget;
                if (input.value !== (task.description ?? "") && !await save({ description: input.value })) input.value = task.description ?? "";
              }}
            /> : <p className="whitespace-pre-wrap text-sm leading-relaxed">{task.description || "No description added."}</p>)}
          {saving && <p role="status" className="text-sm text-muted-foreground">Saving…</p>}
          {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}

          <TaskApprovalPanel task={task} projectId={projectId} canEdit={canEdit} canApprove={canApprove} currentUserId={currentUserId} people={people} disabled={saving || uploading || deleting} />

          <section aria-labelledby={`task-files-${task.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`task-files-${task.id}`} ref={filesHeading} tabIndex={-1} className="scroll-mt-4 rounded-sm text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Files</h3>
              {canEdit && (
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                  <Paperclip className="h-4 w-4" /> {uploading ? "Uploading…" : "Attach files"}
                  <input type="file" multiple aria-label="Attach task files" className="sr-only" disabled={uploading || saving || deleting} onChange={onFile} />
                </label>
              )}
            </div>
            <ul className="mt-2 space-y-1">
              {taskDocs.length === 0 && <li className="text-sm text-muted-foreground">No files yet.</li>}
              {taskDocs.map((d) => (
                <li key={d.id} className="min-w-0">
                  <button type="button" onClick={() => void openDoc(d.path)} className="flex min-h-11 w-full min-w-0 items-start gap-2 rounded-md border bg-background px-3 py-3 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-oak" /> <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{d.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmtSize(d.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby={`task-comments-${task.id}`}>
            <h3 id={`task-comments-${task.id}`} className="text-base font-medium">Comments</h3>
            <form onSubmit={postComment} className="mt-3 space-y-2">
              <Label htmlFor={`task-comment-${task.id}`} className="text-sm">Add a comment or note</Label>
              <Textarea id={`task-comment-${task.id}`} ref={commentInput} placeholder="Write a comment…" className="min-h-24 scroll-mt-4 resize-y text-base md:text-sm" value={body} onChange={(e) => setBody(e.target.value)} disabled={posting} rows={2} />
              {commentError && <p role="alert" className="text-sm text-destructive">{commentError}</p>}
              <Button type="submit" size="sm" className="min-h-11 w-full whitespace-normal text-sm sm:w-auto" disabled={posting || !body.trim()}>{posting ? "Posting…" : "Post comment"}</Button>
            </form>
            {commentsPending && <p className="mt-2 text-sm text-muted-foreground">Loading comments…</p>}
            {commentsFailed && <div role="alert" className="mt-2 text-sm text-destructive">
              <p>Could not load comments: {errorMessage(commentsError)}</p>
              <Button type="button" size="sm" variant="outline" className="mt-2 min-h-11 text-sm" onClick={() => void refetch()}>Retry</Button>
            </div>}
            <ul className="mt-3 space-y-3">
              {comments?.map((c: any) => (
                <li key={c.id} className="min-w-0 rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{c.author?.full_name ?? c.author?.email}</span> ·{" "}
                    {formatDistanceToNow(parseISO(c.created_at), { addSuffix: true })}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{c.body}</p>
                </li>
              ))}
            </ul>
          </section>

          {canEdit && (
            <Button variant="ghost" size="sm" disabled={saving || uploading || deleting} className="min-h-11 w-full whitespace-normal text-sm text-destructive sm:w-auto" onClick={() => void deleteTask()}>
              <Trash2 className="h-4 w-4" /> {deleting ? "Deleting…" : "Delete task"}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
