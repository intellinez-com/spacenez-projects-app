import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { stageLabel } from "@/lib/constants";
import { errorMessage, openDoc, type ProjectPerson, type Task } from "./data";

type Approval = {
  id: string;
  task_id: string;
  revision: number;
  state: string;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  feedback: string | null;
  snapshot: unknown;
};

export function canRespondToApproval(approval: Approval, revision: number, userId: string | null, canApprove: boolean) {
  return canApprove && !!userId && approval.state === "pending" && approval.revision === revision && approval.requested_by !== userId;
}

function stateLabel(state: string) {
  return state === "approved" ? "Approved" : state === "changes_requested" ? "Changes requested" : "Awaiting client review";
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function snapshotObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function ApprovalSnapshot({ snapshot }: { snapshot: unknown }) {
  const source = snapshotObject(snapshot);
  const task = snapshotObject(source["task"]);
  const rawDocuments = source["documents"];
  const docs = Array.isArray(rawDocuments) ? rawDocuments.map(snapshotObject) : [];
  const title = task["title"];
  const stage = task["stage"];
  const stageAtRequest = task["stage_label"];
  const description = task["description"];
  return (
    <div className="mt-2 min-w-0 space-y-2 text-sm [overflow-wrap:anywhere]">
      <p className="font-medium">{typeof title === "string" ? title : "Task details unavailable"}</p>
      {typeof stage === "string" && <p className="text-muted-foreground">{typeof stageAtRequest === "string" && stageAtRequest.trim() ? stageAtRequest : stageLabel(stage)}</p>}
      {typeof description === "string" && <p className="whitespace-pre-wrap leading-relaxed">{description}</p>}
      <p className="text-muted-foreground">Files submitted: {docs.length}</p>
      {docs.length > 0 && <ul className="space-y-1">
        {docs.map((doc, index) => {
          const id = doc["id"];
          const path = doc["path"];
          const name = doc["name"];
          return <li key={typeof id === "string" ? id : index} className="min-w-0">
            {typeof path === "string" ? (
              <button type="button" className="min-h-11 max-w-full rounded-sm py-2 text-left text-oak underline [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void openDoc(path)}>
                {typeof name === "string" ? name : "Open file"}
              </button>
            ) : <span>{typeof name === "string" ? name : "File details unavailable"}</span>}
          </li>;
        })}
      </ul>}
    </div>
  );
}

export function ApprovalOverview({ projectId, tasks, onOpen }: { projectId: string; tasks: Task[]; onOpen: (task: Task) => void }) {
  const query = useQuery({
    queryKey: ["task-approvals", projectId, "overview"],
    queryFn: async () => {
      const [plan, approvals] = await Promise.all([
        supabase.from("task_approval_plan").select("*").eq("project_id", projectId).order("created_at"),
        supabase.from("task_approvals").select("*").eq("project_id", projectId).order("requested_at", { ascending: false }),
      ]);
      if (plan.error) throw plan.error;
      if (approvals.error) throw approvals.error;
      return { plan: plan.data, approvals: approvals.data as Approval[] };
    },
  });
  if (query.isPending) return <p className="text-sm text-muted-foreground">Loading approvals…</p>;
  if (query.isError) return <div role="alert" className="min-w-0 space-y-2 text-sm text-destructive [overflow-wrap:anywhere]">
    <p>Could not load approvals: {errorMessage(query.error)}</p>
    <Button type="button" size="sm" variant="outline" className="min-h-11 text-sm" onClick={() => void query.refetch()}>Retry</Button>
  </div>;
  const { plan, approvals } = query.data;
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const stateFor = (task: Task) => {
    const current = approvals.find((approval) => approval.task_id === task.id && approval.revision === task.content_revision);
    if (current) return stateLabel(current.state);
    return approvals.some((approval) => approval.task_id === task.id) ? "Review needed after changes" : "No review requested";
  };
  const requestedTasks = tasks.filter((task) => approvals.some((approval) => approval.task_id === task.id));
  return <div className="min-w-0 space-y-6 [overflow-wrap:anywhere]">
    <section className="min-w-0 space-y-3">
      <h2 className="text-lg font-semibold">Planned reviews</h2>
      <p className="text-sm text-muted-foreground">Review gates from the project plan. Client decisions appear against the linked task after submission.</p>
      {!plan.length ? <p className="text-sm text-muted-foreground">No planned reviews.</p> : <>
        <ul className="min-w-0 divide-y rounded-md border lg:hidden">{plan.map((entry) => {
          const task = entry.task_id ? taskById.get(entry.task_id) : undefined;
          return <li key={entry.id} className="min-w-0 p-4">
            <dl className="space-y-3 text-sm">
              <div><dt className="text-muted-foreground">Stage gate</dt><dd className="mt-1">{entry.stage_gate || "—"}</dd></div>
              <div><dt className="text-muted-foreground">Milestone</dt><dd>{task ? <button type="button" className="min-h-11 max-w-full rounded-sm py-2 text-left font-medium text-oak underline [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(task)}>{entry.milestone || task.title}</button> : <p className="mt-1">{entry.milestone || "—"}</p>}</dd></div>
              <div><dt className="text-muted-foreground">Review</dt><dd className="mt-1 whitespace-pre-wrap leading-relaxed">{entry.description || "—"}</dd></div>
              <div><dt className="text-muted-foreground">Client decision</dt><dd className="mt-1">{task ? stateFor(task) : "No task linked"}</dd></div>
            </dl>
          </li>;
        })}</ul>
        <div className="hidden max-w-full overflow-x-auto rounded-md border lg:block">
        <table className="w-full min-w-[600px] table-fixed text-left text-sm">
          <caption className="sr-only">Planned client reviews</caption>
          <colgroup><col className="w-1/5" /><col className="w-1/4" /><col className="w-[35%]" /><col className="w-1/5" /></colgroup>
          <thead className="bg-muted/50"><tr>
            <th className="p-3 font-medium">Stage gate</th><th className="p-3 font-medium">Milestone</th><th className="p-3 font-medium">Review</th><th className="p-3 font-medium">Client decision</th>
          </tr></thead>
          <tbody>{plan.map((entry) => {
            const task = entry.task_id ? taskById.get(entry.task_id) : undefined;
            return <tr key={entry.id} className="border-t align-top">
              <td className="p-3">{entry.stage_gate}</td>
              <td className="p-3">{task ? <button type="button" className="min-h-11 max-w-full rounded-sm py-2 text-left text-oak underline [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(task)}>{entry.milestone || task.title}</button> : entry.milestone || "—"}</td>
              <td className="p-3">{entry.description || "—"}</td>
              <td className="p-3">{task ? stateFor(task) : "No task linked"}</td>
            </tr>;
          })}</tbody>
        </table>
        </div>
      </>}
    </section>
    <section className="min-w-0 space-y-3">
      <h2 className="text-lg font-semibold">Client reviews</h2>
      {!requestedTasks.length ? <p className="text-sm text-muted-foreground">Open a task to request client review.</p> : <ul className="divide-y rounded-md border">
        {requestedTasks.map((task) => <li key={task.id} className="flex min-w-0 flex-col items-start justify-between gap-2 p-3 text-sm sm:flex-row sm:items-center">
          <button type="button" className="min-h-11 min-w-0 max-w-full rounded-sm py-2 text-left text-oak underline [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-1" onClick={() => onOpen(task)}>{task.title}</button>
          <span>{stateFor(task)}</span>
        </li>)}
      </ul>}
    </section>
  </div>;
}

export function TaskApprovalPanel({ task, projectId, currentUserId, canEdit, canApprove, people, disabled = false }: {
  task: Task;
  projectId: string;
  currentUserId: string | null;
  canEdit: boolean;
  canApprove: boolean;
  people: ProjectPerson[];
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["task-approvals", projectId, task.id],
    queryFn: async () => {
      const [approvals, plan] = await Promise.all([
        supabase.from("task_approvals").select("*").eq("project_id", projectId).eq("task_id", task.id).order("requested_at", { ascending: false }),
        supabase.from("task_approval_plan").select("*").eq("project_id", projectId).eq("task_id", task.id).order("created_at"),
      ]);
      if (approvals.error) throw approvals.error;
      if (plan.error) throw plan.error;
      return { approvals: approvals.data as Approval[], plan: plan.data };
    },
  });
  const approvals = query.data?.approvals ?? [];
  const current = approvals.find((approval) => approval.revision === task.content_revision);
  const awaiting = current?.state === "pending" ? current : undefined;
  const canRespond = awaiting && canRespondToApproval(awaiting, task.content_revision, currentUserId, canApprove);
  const locked = disabled || !!busy;
  useEffect(() => {
    setFeedback("");
    setActionError(null);
  }, [task.id]);
  const person = (id: string) => {
    const profile = people.find((entry) => entry.id === id);
    return profile?.full_name || profile?.email || "Project member";
  };

  async function refreshReviewState() {
    // The overview and individual task panels share this project-wide prefix.
    // Refetch errors remain visible in their query views, without hiding the
    // original action error or discarding a failed submission's feedback draft.
    await Promise.allSettled([
      qc.invalidateQueries({ queryKey: ["task-approvals", projectId] }),
      qc.invalidateQueries({ queryKey: ["project", projectId] }),
      qc.invalidateQueries({ queryKey: ["project-activity"] }),
    ]);
  }

  async function act(action: "request" | "approved" | "changes_requested") {
    if (locked) return;
    if (!currentUserId) { setActionError("Your session has expired. Sign in again before reviewing this task."); return; }
    if (action === "changes_requested" && !feedback.trim()) { setActionError("Describe the changes needed before submitting."); return; }
    setBusy(action);
    setActionError(null);
    try {
      if (action === "request") {
        const { error } = await supabase.rpc("request_task_approval", { p_task_id: task.id });
        if (error) throw error;
      } else {
        if (!awaiting || !canRespondToApproval(awaiting, task.content_revision, currentUserId, canApprove)) throw new Error("This review is no longer available. Refresh and try again.");
        const { error } = await supabase.rpc("respond_task_approval", {
          p_approval_id: awaiting.id,
          p_decision: action,
          p_feedback: feedback.trim() || null,
        });
        if (error) throw error;
      }
      setFeedback("");
      await refreshReviewState();
    } catch (error) {
      setActionError(errorMessage(error));
      // A rejection may mean the content revision or project access changed.
      // Refresh authoritative state; leave resubmission to the user.
      await refreshReviewState();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="min-w-0 space-y-3 border-t pt-4 [overflow-wrap:anywhere]" aria-label="Client approval">
      <h3 className="text-sm font-semibold">Client approval</h3>
      {query.isPending ? <p className="text-sm text-muted-foreground">Loading approval history…</p> : query.isError ? (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>Could not load approval history: {errorMessage(query.error)}</p>
          <Button type="button" size="sm" variant="outline" className="min-h-11 text-sm" onClick={() => void query.refetch()}>Retry</Button>
        </div>
      ) : <>
        {(query.data?.plan.length ?? 0) > 0 && <div className="space-y-1 text-sm">
          <p className="font-medium">Planned reviews</p>
          <ul className="space-y-2">{query.data?.plan.map((entry) => <li key={entry.id}>
            <p>{[entry.stage_gate, entry.milestone].filter(Boolean).join(" · ")}</p>
            {entry.description && <p className="text-muted-foreground">{entry.description}</p>}
          </li>)}</ul>
          <p className="text-xs text-muted-foreground">Imported from the project plan. A client decision is recorded below when submitted.</p>
        </div>}
        <p className="text-sm">
          {current ? stateLabel(current.state) : approvals.length ? "Task content changed. A new client review is needed." : "No client review requested."}
        </p>
        <p className="text-xs text-muted-foreground">Review covers the submitted title, description, stage and files. Task status is tracked separately.</p>
        {canEdit && <Button type="button" size="sm" variant="outline" className="h-auto min-h-11 w-full whitespace-normal py-2 text-sm sm:w-auto" disabled={locked || !!current} onClick={() => void act("request")}>
          {busy === "request" ? "Requesting…" : "Request client review"}
        </Button>}
        {canEdit && current?.state === "changes_requested" && <p className="text-sm text-muted-foreground">Update the submitted task content or files, then request a new review.</p>}
        {canRespond && <div className="space-y-2">
          <Label htmlFor={`approval-feedback-${task.id}`}>Review feedback</Label>
          <Textarea id={`approval-feedback-${task.id}`} className="min-h-28 resize-y text-base md:text-sm" value={feedback} onChange={(event) => setFeedback(event.target.value)} disabled={locked} rows={3} placeholder="Add a note, or describe changes needed" />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button type="button" size="sm" className="h-auto min-h-11 whitespace-normal py-2 text-sm" disabled={locked} onClick={() => void act("approved")}>{busy === "approved" ? "Submitting…" : "Approve"}</Button>
            <Button type="button" size="sm" variant="outline" className="h-auto min-h-11 whitespace-normal py-2 text-sm" disabled={locked} onClick={() => void act("changes_requested")}>{busy === "changes_requested" ? "Submitting…" : "Request changes"}</Button>
          </div>
        </div>}
        {awaiting && canApprove && awaiting.requested_by === currentUserId && <p className="text-sm text-muted-foreground">Another client must review your submission.</p>}
        <ul className="min-w-0 space-y-3">{approvals.map((approval) => <li key={approval.id} className="min-w-0 rounded-md border p-3 text-sm">
          <p className="font-medium">{stateLabel(approval.state)}{approval.revision !== task.content_revision ? " · Earlier task content" : ""}</p>
          <p className="mt-1 text-xs text-muted-foreground">Requested by {person(approval.requested_by)} on {formatTime(approval.requested_at)}</p>
          {approval.decided_by && approval.decided_at && <p className="text-xs text-muted-foreground">Reviewed by {person(approval.decided_by)} on {formatTime(approval.decided_at)}</p>}
          {approval.feedback && <p className="mt-2 whitespace-pre-wrap leading-relaxed">{approval.feedback}</p>}
          <details className="mt-2 min-w-0" open={!!canRespond && awaiting?.id === approval.id}>
            <summary className="min-h-11 cursor-pointer rounded-sm py-3 text-oak focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View submitted content</summary>
            <ApprovalSnapshot snapshot={approval.snapshot} />
          </details>
        </li>)}</ul>
      </>}
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
    </section>
  );
}
