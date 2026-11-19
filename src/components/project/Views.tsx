import { useState } from "react";
import { format, parseISO, differenceInCalendarDays, addDays, min as minDate, max as maxDate } from "date-fns";
import { Plus, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGES, STATUSES, PRIORITIES } from "@/lib/constants";
import { statusBg } from "@/components/StatusPill";
import { isTaskOverdue } from "@/lib/task-dates";
import { Input } from "@/components/ui/input";
import type { Task, Profile } from "./data";

type Common = {
  tasks: Task[];
  people: Profile[];
  canEdit: boolean;
  onOpen: (t: Task) => void;
  onUpdate: (id: string, patch: Partial<Task>) => Promise<void>;
};

const selectCls = "h-8 w-full rounded-md border-0 bg-transparent px-1 text-sm hover:bg-muted focus:outline-none disabled:opacity-100";

export function TableView({ tasks, people, canEdit, onOpen, onUpdate, onAdd }: Common & { onAdd: (stage: string, title: string, pos: number) => Promise<void> }) {
  const save = (id: string, patch: Partial<Task>) => { void onUpdate(id, patch).catch(() => undefined); };
  return (
    <div className="space-y-8">
      {STAGES.map((stage, si) => {
        const rows = tasks.filter((t) => t.stage === stage.key);
        const done = rows.filter((r) => r.status === "done").length;
        return (
          <section key={stage.key}>
            <div className="mb-2 flex items-baseline gap-3">
              <span className="font-display text-lg text-oak">{String(si + 1).padStart(2, "0")}</span>
              <h3 className="text-lg">{stage.label}</h3>
              <span className="text-xs text-muted-foreground">{done}/{rows.length} done</span>
            </div>
            <div className="overflow-x-auto rounded-lg border bg-card">
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
                          <button onClick={() => onOpen(t)} className="flex items-center gap-2 text-left font-medium hover:text-oak">
                            {t.title} <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        </td>
                        <td className="p-1">
                          <select disabled={!canEdit} className={selectCls} value={t.status} onChange={(e) => save(t.id, { status: e.target.value })}>
                            {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                        </td>
                        <td className="p-1">
                          <select disabled={!canEdit} className={selectCls} value={t.assignee_id ?? ""} onChange={(e) => save(t.id, { assignee_id: e.target.value || null })}>
                            <option value="">—</option>
                            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>)}
                          </select>
                        </td>
                        <td className="p-1">
                          <select disabled={!canEdit} className={selectCls} value={t.priority} onChange={(e) => save(t.id, { priority: e.target.value })}>
                            {PRIORITIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                        </td>
                        <td className="p-1">
                          <input type="date" disabled={!canEdit} className={cn(selectCls, overdue && "text-destructive")} value={t.due_date ?? ""} onChange={(e) => save(t.id, { due_date: e.target.value || null })} />
                        </td>
                      </tr>
                    );
                  })}
                  {canEdit && <AddRow onAdd={(title) => onAdd(stage.key, title, tasks.length)} />}
                  {!canEdit && rows.length === 0 && (
                    <tr><td /><td colSpan={5} className="p-3 text-muted-foreground">No items yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function AddRow({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
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
    <tr className="border-t">
      <td />
      <td colSpan={5} className="p-1">
        <form onSubmit={submit} className="flex items-center gap-2">
          <Plus className="ml-1 h-4 w-4 text-muted-foreground" />
          <Input aria-label="New task title" disabled={busy} value={v} onChange={(e) => setV(e.target.value)} placeholder={busy ? "Adding…" : "Add item"} className="h-8 border-0 shadow-none focus-visible:ring-0" />
        </form>
      </td>
    </tr>
  );
}

export function BoardView({ tasks, people, canEdit, onOpen, onUpdate }: Common) {
  const [over, setOver] = useState<string | null>(null);
  const name = (id: string | null) => people.find((p) => p.id === id)?.full_name;
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {STATUSES.map((s) => {
        const col = tasks.filter((t) => t.status === s.key);
        return (
          <div
            key={s.key}
            onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOver(s.key); } }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => { const id = e.dataTransfer.getData("text/plain"); setOver(null); if (canEdit && tasks.some((t) => t.id === id)) { e.preventDefault(); void onUpdate(id, { status: s.key }).catch(() => undefined); } }}
            className={cn("w-72 shrink-0 rounded-xl bg-muted/60 p-3 transition", over === s.key && "ring-2 ring-oak")}
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
                  className="block w-full rounded-lg border bg-card p-3 text-left shadow-soft hover:border-oak"
                >
                  <p className="text-xs text-muted-foreground">{STAGES.find((x) => x.key === t.stage)?.label}</p>
                  <p className="mt-1 text-sm font-medium">{t.title}</p>
                  <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                    <span>{name(t.assignee_id) ?? ""}</span>
                    <span>{t.due_date ? format(parseISO(t.due_date), "d MMM") : ""}</span>
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
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div className="min-w-[900px]">
        <div className="relative ml-64 h-8 border-b text-xs text-muted-foreground">
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
                  <div key={t.id} className="flex h-9 items-center border-t">
                    <button onClick={() => onOpen(t)} className="w-64 shrink-0 truncate px-3 text-left text-sm hover:text-oak">{t.title}</button>
                    <div className="relative h-full flex-1">
                      {today >= from && today <= to && <div className="absolute inset-y-0 w-px bg-destructive/50" style={{ left: `${pct(today)}%` }} />}
                      <button
                        onClick={() => onOpen(t)}
                        className={cn("absolute top-2 h-5 rounded", statusBg(t.status))}
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
