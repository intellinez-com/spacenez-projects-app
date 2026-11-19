import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Paperclip, Trash2, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STAGES, STATUSES, PRIORITIES } from "@/lib/constants";
import { type Task, type Profile, type Doc, uploadDoc, openDoc, fmtSize, errorMessage } from "./data";
import { TaskApprovalPanel } from "./approvals";

type TaskSheetProps = {
  task: Task | null;
  projectId: string;
  canEdit: boolean;
  canApprove: boolean;
  currentUserId: string | null;
  people: Profile[];
  docs: Doc[];
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<Task>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export function TaskSheet(props: TaskSheetProps) {
  return props.task ? <TaskSheetContent key={props.task.id} {...props} task={props.task} /> : null;
}

function TaskSheetContent({ task, projectId, canEdit, canApprove, currentUserId, people, docs, onClose, onUpdate, onDelete }: Omit<TaskSheetProps, "task"> & { task: Task }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);
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
      setUploading(false);
      input.value = "";
    }
  }

  const field = (label: string, el: React.ReactNode) => (
    <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{el}</div>
  );

  return (
    <Sheet open={!!task} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="sr-only">Task details</SheetTitle>
        </SheetHeader>
        <div className="space-y-5 px-1">
          <Input
            key={task.id + "t"}
            defaultValue={task.title}
            disabled={editingDisabled}
            onBlur={async (e) => {
              const input = e.currentTarget;
              if (input.value === task.title) return;
              if (!input.value.trim()) { input.value = task.title; setSaveError("Enter a task title."); return; }
              const value = input.value.trim();
              input.value = await save({ title: value }) ? value : task.title;
            }}
            className="border-0 px-0 font-display text-2xl shadow-none focus-visible:ring-0"
          />
          <div className="grid grid-cols-2 gap-3">
            {field("Status",
              <Select disabled={editingDisabled} value={task.status} onValueChange={(v) => void save({ status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
              </Select>)}
            {field("Stage",
              <Select disabled={editingDisabled} value={task.stage} onValueChange={(v) => void save({ stage: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STAGES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
              </Select>)}
            {field("Priority",
              <Select disabled={editingDisabled} value={task.priority} onValueChange={(v) => void save({ priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
              </Select>)}
            {field("Owner",
              <Select disabled={editingDisabled} value={task.assignee_id ?? "none"} onValueChange={(v) => void save({ assignee_id: v === "none" ? null : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name ?? p.email}</SelectItem>)}
                </SelectContent>
              </Select>)}
            {field("Start", <Input type="date" disabled={editingDisabled} value={task.start_date ?? ""} onChange={(e) => void save({ start_date: e.target.value || null })} />)}
            {field("Due", <Input type="date" disabled={editingDisabled} value={task.due_date ?? ""} onChange={(e) => void save({ due_date: e.target.value || null })} />)}
          </div>
          {field("Description",
            <Textarea
              key={task.id + "d"}
              rows={4}
              disabled={editingDisabled}
              defaultValue={task.description ?? ""}
              onBlur={async (e) => {
                const input = e.currentTarget;
                if (input.value !== (task.description ?? "") && !await save({ description: input.value })) input.value = task.description ?? "";
              }}
            />)}
          {saving && <p role="status" className="text-sm text-muted-foreground">Saving…</p>}
          {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}

          <TaskApprovalPanel task={task} projectId={projectId} canEdit={canEdit} canApprove={canApprove} currentUserId={currentUserId} people={people} disabled={saving || uploading || deleting} />

          <div>
            <div className="flex items-center justify-between">
              <p className="eyebrow">Files</p>
              {canEdit && (
                <label className="flex cursor-pointer items-center gap-1 text-sm text-oak hover:underline">
                  <Paperclip className="h-4 w-4" /> {uploading ? "Uploading…" : "Attach"}
                  <input type="file" multiple className="hidden" disabled={uploading || saving || deleting} onChange={onFile} />
                </label>
              )}
            </div>
            <ul className="mt-2 space-y-1">
              {taskDocs.length === 0 && <li className="text-sm text-muted-foreground">No files yet.</li>}
              {taskDocs.map((d) => (
                <li key={d.id}>
                  <button onClick={() => openDoc(d.path)} className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-muted">
                    <FileText className="h-4 w-4 text-oak" /> <span className="flex-1 truncate">{d.name}</span>
                    <span className="text-xs text-muted-foreground">{fmtSize(d.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="eyebrow">Comments</p>
            {commentsPending && <p className="mt-2 text-sm text-muted-foreground">Loading comments…</p>}
            {commentsFailed && <div role="alert" className="mt-2 text-sm text-destructive">
              <p>Could not load comments: {errorMessage(commentsError)}</p>
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void refetch()}>Retry</Button>
            </div>}
            <ul className="mt-3 space-y-3">
              {comments?.map((c: any) => (
                <li key={c.id} className="rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{c.author?.full_name ?? c.author?.email}</span> ·{" "}
                    {formatDistanceToNow(parseISO(c.created_at), { addSuffix: true })}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
                </li>
              ))}
            </ul>
            <form onSubmit={postComment} className="mt-3 space-y-2">
              <Textarea placeholder="Write a comment…" value={body} onChange={(e) => setBody(e.target.value)} disabled={posting} rows={2} />
              {commentError && <p role="alert" className="text-sm text-destructive">{commentError}</p>}
              <Button type="submit" size="sm" disabled={posting || !body.trim()}>{posting ? "Posting…" : "Post comment"}</Button>
            </form>
          </div>

          {canEdit && (
            <Button variant="ghost" size="sm" disabled={saving || uploading || deleting} className="text-destructive" onClick={() => void deleteTask()}>
              <Trash2 className="h-4 w-4" /> {deleting ? "Deleting…" : "Delete task"}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
