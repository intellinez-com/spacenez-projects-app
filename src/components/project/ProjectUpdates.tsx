import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isValid, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "./data";

export async function loadProjectUpdates(projectId: string, offset = 0, limit = 50) {
  const { data, error } = await supabase.from("comments")
    .select("id,project_id,task_id,user_id,body,created_at,author:profiles(full_name,email),task:tasks!comments_task_project_fkey(title)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data ?? [];
}

type ProjectUpdate = Awaited<ReturnType<typeof loadProjectUpdates>>[number];

export function ProjectUpdates({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  return <ProjectUpdatesContent key={projectId} projectId={projectId} canEdit={canEdit} />;
}

function ProjectUpdatesContent({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const submitting = useRef(false);
  const updates = useQuery({ queryKey: ["project-updates", projectId, "page", page], queryFn: () => loadProjectUpdates(projectId, page * 50, 50) });

  async function post(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim() || submitting.current) return;
    submitting.current = true; setPosting(true); setPostError("");
    try {
      const { data: session, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!session.user) throw new Error("Your session has expired. Sign in again before posting.");
      const { error } = await supabase.from("comments").insert({ project_id: projectId, task_id: null, user_id: session.user.id, body: draft.trim() });
      if (error) throw error;
      setDraft(""); setPage(0);
      void qc.invalidateQueries({ queryKey: ["project-updates", projectId] });
      void qc.invalidateQueries({ queryKey: ["comments", projectId] });
    } catch (failure) { setPostError(errorMessage(failure)); }
    finally { submitting.current = false; setPosting(false); }
  }

  return (
    <section className="max-w-3xl space-y-6" aria-labelledby="project-updates-heading">
      <h2 id="project-updates-heading" className="text-xl">Project updates and comments</h2>
      <form onSubmit={post} className="space-y-3">
        <Label htmlFor={`project-update-${projectId}`}>{canEdit ? "Share a project update" : "Leave a comment for the team"}</Label>
        <Textarea id={`project-update-${projectId}`} rows={3} maxLength={10_000} disabled={posting} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={canEdit ? "What changed, and what happens next?" : "Ask a question or share your feedback…"} />
        {postError && <p role="alert" className="text-sm text-destructive">{postError}</p>}
        <Button type="submit" disabled={posting || !draft.trim()}>{posting ? "Posting…" : canEdit ? "Post update" : "Post comment"}</Button>
      </form>
      <div>
        {updates.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading updates…</p> : updates.isError ? (
          <div role="alert" className="space-y-2 text-sm"><p>Could not load project updates. {errorMessage(updates.error)}</p><Button variant="outline" size="sm" onClick={() => void updates.refetch()}>Retry updates</Button></div>
        ) : updates.data.length === 0 ? <p className="text-sm text-muted-foreground">{page === 0 ? "No updates or comments yet." : "No older updates."}</p> : <UpdateList updates={updates.data} />}
        <div className="mt-4 flex gap-2">
          {page > 0 && <Button variant="outline" size="sm" disabled={updates.isFetching} onClick={() => setPage((current) => current - 1)}>Newer updates</Button>}
          {updates.data?.length === 50 && <Button variant="outline" size="sm" disabled={updates.isFetching} onClick={() => setPage((current) => current + 1)}>Older updates</Button>}
        </div>
      </div>
    </section>
  );
}

export function RecentProjectUpdates({ projectId, onOpenUpdates }: { projectId: string; onOpenUpdates: () => void }) {
  const updates = useQuery({ queryKey: ["project-updates", projectId, "recent"], queryFn: () => loadProjectUpdates(projectId, 0, 5) });
  return (
    <section aria-labelledby="recent-updates-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="recent-updates-heading" className="text-lg">Latest updates</h2><Button variant="outline" size="sm" onClick={onOpenUpdates}>All updates and comments</Button></div>
      {updates.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading updates…</p> : updates.isError ? (
        <div role="alert" className="space-y-2 text-sm"><p>Could not load recent updates.</p><Button variant="outline" size="sm" onClick={() => void updates.refetch()}>Retry updates</Button></div>
      ) : updates.data.length === 0 ? <p className="text-sm text-muted-foreground">No updates or comments yet.</p> : <UpdateList updates={updates.data} />}
    </section>
  );
}

function UpdateList({ updates }: { updates: ProjectUpdate[] }) {
  return <ul className="divide-y rounded-lg border">{updates.map((update) => {
    const date = parseISO(update.created_at);
    return <li key={update.id} className="space-y-1 p-4">
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{update.author?.full_name || update.author?.email || "Project member"}</span>
        <time dateTime={isValid(date) ? update.created_at : undefined} className="text-xs text-muted-foreground">{isValid(date) ? format(date, "d MMM yyyy, h:mm a") : "Date unavailable"}</time>
      </div>
      <p className="text-xs text-muted-foreground">{update.task_id ? `Comment on ${update.task?.title || "a project task"}` : "Project update or comment"}</p>
      <p className="whitespace-pre-wrap break-words text-sm">{update.body}</p>
    </li>;
  })}</ul>;
}
