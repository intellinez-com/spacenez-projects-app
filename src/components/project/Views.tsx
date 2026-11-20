import { useState } from "react";
import { format, parseISO, differenceInCalendarDays, addDays, min as minDate, max as maxDate } from "date-fns";
import { Plus, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGES, STATUSES, PRIORITIES } from "@/lib/constants";
import { StatusPill, statusBg } from "@/components/StatusPill";
import { isTaskOverdue } from "@/lib/task-dates";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Task, Profile } from "./data";

type Common = {
  tasks: Task[];
  people: Profile[];
  canEdit: boolean;
  onOpen: (t: Task) => void;
  onUpdate: (id: string, patch: Partial<Task>) => Promise<void>;
};

const selectCls = "h-8 w-full rounded-md border-0 bg-transparent px-1 text-sm hover:bg-muted focus:outline-none disabled:opacity-100";
const touchFieldCls = "h-11 min-w-0 w-full max-w-full rounded-md border border-input bg-background px-2 text-base focus:outline-none focus:ring-1 focus:ring-ring";
const displayDate = (date: string | null) => date ? format(parseISO(date), "d MMM yyyy") : "Not set";
function displayOwner(id: string | null, people: Profile[]) {
  if (!id) return "Not assigned";
  const owner = people.find((person) => person.id === id);
  return owner?.full_name ?? owner?.email ?? "Assigned team member";
}

export function TableView({ tasks, people, canEdit, onOpen, onUpdate, onAdd }: Common & { onAdd: (stage: string, title: string, pos: number) => Promise<void> }) {
  const save = (id: string, patch: Partial<Task>) => { void onUpdate(id, patch).catch(() => undefined); };
  return (
    <div className="space-y-8">
      {STAGES.map((stage, si) => {
        const rows = tasks.filter((t) => t.stage === stage.key);
        const done = rows.filter((r) => r.status === "done").length;
        return (
          <section key={stage.key} aria-label={stage.label} className="min-w-0">
            <div className="mb-2 flex items-baseline gap-3">
              <span className="shrink-0 font-display text-lg text-oak">{String(si + 1).padStart(2, "0")}</span>
              <h3 className="min-w-0 flex-1 break-words text-lg">{stage.label}</h3>
              <span className="shrink-0 text-xs text-muted-foreground">{done}/{rows.length} done</span>
            </div>
            <div className="min-w-0 overflow-hidden rounded-lg border bg-card">
            <div className="xl:hidden">
              <div role="list" aria-label={`${stage.label} work items`} className="divide-y">
                {rows.map((task) => <TaskListItem key={task.id} task={task} people={people} canEdit={canEdit} onOpen={onOpen} save={save} />)}
              </div>
              {rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">No items yet.</p>}
            </div>
            <div className="hidden min-w-0 overflow-x-auto xl:block">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="w-1 p-0" />
                    <th className="p-2 font-medium">Item</th>
                    <th className="w-36 p-2 font-medium">Status</th>
                    <th className="w-40 p-2 font-medium">Owner</th>
                    <th className="w-28 p-2 font-medium">Priority</th>
                    <th className="w-36 p-2 font-medium">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const overdue = isTaskOverdue(t);
                    return (
                      <tr key={t.id} className="border-t hover:bg-muted/30">
                        <td className={cn("w-1 p-0", statusBg(t.status))} />
                        <td className="p-2">
                          <button onClick={() => onOpen(t)} className="flex min-h-11 items-center gap-2 text-left font-medium [overflow-wrap:anywhere] hover:text-oak">
                            {t.title} <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          </button>
                        </td>
                        <td className="p-1">
                          {canEdit ? <select aria-label={`Status for ${t.title}`} className={selectCls} value={t.status} onChange={(e) => save(t.id, { status: e.target.value })}>
                            {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select> : <span className="px-1">{STATUSES.find((status) => status.key === t.status)?.label ?? t.status}</span>}
                        </td>
                        <td className="p-1">
                          {canEdit ? <select aria-label={`Owner for ${t.title}`} className={selectCls} value={t.assignee_id ?? ""} onChange={(e) => save(t.id, { assignee_id: e.target.value || null })}>
                            <option value="">—</option>
                            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>)}
                          </select> : <span className="block px-1 [overflow-wrap:anywhere]">{displayOwner(t.assignee_id, people)}</span>}
                        </td>
                        <td className="p-1">
                          {canEdit ? <select aria-label={`Priority for ${t.title}`} className={selectCls} value={t.priority} onChange={(e) => save(t.id, { priority: e.target.value })}>
                            {PRIORITIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select> : <span className="px-1">{PRIORITIES.find((priority) => priority.key === t.priority)?.label ?? t.priority}</span>}
                        </td>
                        <td className="p-1">
                          {canEdit ? <input aria-label={`Due date for ${t.title}`} type="date" className={cn(selectCls, overdue && "text-destructive")} value={t.due_date ?? ""} onChange={(e) => save(t.id, { due_date: e.target.value || null })} /> : <span className={cn("px-1", overdue && "text-destructive")}>{displayDate(t.due_date)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {!canEdit && rows.length === 0 && (
                    <tr><td /><td colSpan={5} className="p-3 text-muted-foreground">No items yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {canEdit && <div className="border-t p-3"><AddItemForm stage={stage.label} onAdd={(title) => onAdd(stage.key, title, tasks.length)} /></div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TaskListItem({ task, people, canEdit, onOpen, save }: {
  task: Task;
  people: Profile[];
  canEdit: boolean;
  onOpen: (task: Task) => void;
  save: (id: string, patch: Partial<Task>) => void;
}) {
  const overdue = isTaskOverdue(task);
  return (
    <div role="listitem" className="min-w-0 p-3 sm:p-4">
      <button onClick={() => onOpen(task)} className="flex min-h-11 w-full min-w-0 items-center justify-between gap-3 text-left text-sm font-medium hover:text-oak">
        <span className="min-w-0 [overflow-wrap:anywhere]">{task.title}</span>
        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      {canEdit ? (
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3">
          <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
            <span>Status</span>
            <select aria-label={`Status for ${task.title}`} className={touchFieldCls} value={task.status} onChange={(e) => save(task.id, { status: e.target.value })}>
              {STATUSES.map((status) => <option key={status.key} value={status.key}>{status.label}</option>)}
            </select>
          </label>
          <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
            <span>Owner</span>
            <select aria-label={`Owner for ${task.title}`} className={touchFieldCls} value={task.assignee_id ?? ""} onChange={(e) => save(task.id, { assignee_id: e.target.value || null })}>
              <option value="">Not assigned</option>
              {people.map((person) => <option key={person.id} value={person.id}>{person.full_name ?? person.email}</option>)}
            </select>
          </label>
          <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
            <span>Priority</span>
            <select aria-label={`Priority for ${task.title}`} className={touchFieldCls} value={task.priority} onChange={(e) => save(task.id, { priority: e.target.value })}>
              {PRIORITIES.map((priority) => <option key={priority.key} value={priority.key}>{priority.label}</option>)}
            </select>
          </label>
          <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
            <span>Start date</span>
            <input aria-label={`Start date for ${task.title}`} type="date" className={touchFieldCls} value={task.start_date ?? ""} onChange={(e) => save(task.id, { start_date: e.target.value || null })} />
          </label>
          <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
            <span>Due date{overdue ? " · Overdue" : ""}</span>
            <input aria-label={`Due date for ${task.title}`} type="date" className={cn(touchFieldCls, overdue && "text-destructive")} value={task.due_date ?? ""} onChange={(e) => save(task.id, { due_date: e.target.value || null })} />
          </label>
        </div>
      ) : (
        <>
          <StatusPill status={task.status} className="mt-2" />
          <dl className="mt-3 grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Owner</dt><dd className="mt-1 [overflow-wrap:anywhere]">{displayOwner(task.assignee_id, people)}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Priority</dt><dd className="mt-1">{PRIORITIES.find((priority) => priority.key === task.priority)?.label ?? task.priority}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Start date</dt><dd className="mt-1">{displayDate(task.start_date)}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Due date</dt><dd className={cn("mt-1", overdue && "text-destructive")}>{displayDate(task.due_date)}{overdue && <span className="block text-xs">Overdue</span>}</dd></div>
          </dl>
        </>
      )}
    </div>
  );
}

function AddItemForm({ stage, onAdd }: { stage: string; onAdd: (title: string) => Promise<void> }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!v.trim() || busy) return;
    setBusy(true);
    try { await onAdd(v.trim()); setV(""); } catch { /* Mutation reports its error; keep the draft. */ }
    finally { setBusy(false); }
  }
  return (
    <form aria-label={`Add item to ${stage}`} onSubmit={submit} className="flex min-w-0 flex-wrap items-center gap-2">
      <Input aria-label={`New ${stage} item title`} disabled={busy} value={v} onChange={(e) => setV(e.target.value)} placeholder="New item title" className="min-w-0 flex-1 basis-40" />
      <Button type="submit" variant="outline" disabled={busy || !v.trim()}><Plus className="h-4 w-4" />{busy ? "Adding…" : "Add item"}</Button>
    </form>
  );
}

export function BoardView({ tasks, people, canEdit, onOpen, onUpdate }: Common) {
  const [over, setOver] = useState<string | null>(null);
  const name = (id: string | null) => people.find((p) => p.id === id)?.full_name;
  return (
    <div role="region" aria-label="Work board by status" tabIndex={0} className="flex max-w-full gap-4 overflow-x-auto overscroll-x-contain pb-4">
      {STATUSES.map((s) => {
        const col = tasks.filter((t) => t.status === s.key);
        return (
          <div
            key={s.key}
            onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOver(s.key); } }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => { const id = e.dataTransfer.getData("text/plain"); setOver(null); if (canEdit && tasks.some((t) => t.id === id)) { e.preventDefault(); void onUpdate(id, { status: s.key }).catch(() => undefined); } }}
            className={cn("w-72 max-w-[calc(100vw-2rem)] shrink-0 rounded-lg bg-muted/60 p-3 transition", over === s.key && "ring-2 ring-oak")}
          >
            <div className="mb-3 flex items-center gap-2 px-1">
              <span className={cn("h-2.5 w-2.5 rounded-full", statusBg(s.key))} />
              <p className="text-sm font-semibold">{s.label}</p>
              <span className="text-xs text-muted-foreground">{col.length}</span>
            </div>
            <div className="space-y-2">
              {col.map((t) => (
                <button
                  key={t.id}
                  draggable={canEdit}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
                  onClick={() => onOpen(t)}
                  className="block min-h-11 w-full min-w-0 rounded-lg border bg-card p-3 text-left shadow-soft [overflow-wrap:anywhere] hover:border-oak"
                >
                  <p className="text-xs text-muted-foreground">{STAGES.find((x) => x.key === t.stage)?.label}</p>
                  <p className="mt-1 text-sm font-medium">{t.title}</p>
                  <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="min-w-0">{name(t.assignee_id) ?? ""}</span>
                    <span className="shrink-0">{t.due_date ? format(parseISO(t.due_date), "d MMM") : ""}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TimelineView({ tasks, onOpen }: Pick<Common, "tasks" | "onOpen">) {
  const dated = tasks.filter((t) => t.start_date || t.due_date);
  if (!dated.length)
    return <p className="rounded-xl border border-dashed bg-card p-10 text-center text-muted-foreground">Add start and due dates to items to see them on the timeline.</p>;
  const starts = dated.map((t) => parseISO((t.start_date ?? t.due_date)!));
  const ends = dated.map((t) => parseISO((t.due_date ?? t.start_date)!));
  const from = addDays(minDate(starts), -3);
  const to = addDays(maxDate(ends), 3);
  const total = Math.max(1, differenceInCalendarDays(to, from));
  const weeks: Date[] = [];
  for (let d = from; d <= to; d = addDays(d, 7)) weeks.push(d);
  const pct = (d: Date) => (differenceInCalendarDays(d, from) / total) * 100;
  const today = new Date();

  return (
    <div role="region" aria-label="Work timeline" tabIndex={0} className="max-w-full overflow-x-auto overscroll-x-contain rounded-lg border bg-card">
      <div className="min-w-[900px]">
        <div className="relative ml-36 h-8 border-b text-xs text-muted-foreground sm:ml-48 lg:ml-64">
          {weeks.map((w) => (
            <span key={w.toISOString()} className="absolute top-2" style={{ left: `${pct(w)}%` }}>{format(w, "d MMM")}</span>
          ))}
        </div>
        {STAGES.map((stage) => {
          const rows = dated.filter((t) => t.stage === stage.key);
          if (!rows.length) return null;
          return (
            <div key={stage.key}>
              <div className="bg-muted/50 px-3 py-1.5 text-xs font-semibold">{stage.label}</div>
              {rows.map((t) => {
                const s = parseISO((t.start_date ?? t.due_date)!);
                const e = parseISO((t.due_date ?? t.start_date)!);
                return (
                  <div key={t.id} className="flex min-h-11 items-stretch border-t">
                    <button onClick={() => onOpen(t)} className="sticky left-0 z-10 min-h-11 w-36 shrink-0 bg-card px-3 py-2 text-left text-sm [overflow-wrap:anywhere] hover:text-oak sm:w-48 lg:w-64">{t.title}</button>
                    <div className="relative min-h-11 flex-1">
                      {today >= from && today <= to && <div className="absolute inset-y-0 w-px bg-destructive/50" style={{ left: `${pct(today)}%` }} />}
                      <button
                        onClick={() => onOpen(t)}
                        aria-label={`Open ${t.title}`}
                        className={cn("absolute inset-y-0 min-h-11 rounded border-y-[12px] border-transparent bg-clip-padding", statusBg(t.status))}
                        style={{ left: `${pct(s)}%`, width: `${Math.max(1, ((differenceInCalendarDays(e, s) + 1) / total) * 100)}%` }}
                        title={t.title}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
