import { useEffect, useId, useRef, useState } from "react";
import { format, parseISO, differenceInCalendarDays, addDays, min as minDate, max as maxDate } from "date-fns";
import { Plus, MessageSquare, Paperclip, Search, ChevronDown, ChevronRight, ChevronUp, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGES, STATUSES, PRIORITIES, stageLabel, statusLabel } from "@/lib/constants";
import { statusBg } from "@/components/StatusPill";
import { isTaskOverdue } from "@/lib/task-dates";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Task, ProjectPerson, Doc } from "./data";

type Common = {
  tasks: Task[];
  people: ProjectPerson[];
  canEdit: boolean;
  onOpen: (t: Task, section?: "comments" | "files") => void;
  onUpdate: (id: string, patch: Partial<Task>) => Promise<void>;
};

type RowState = {
  busy: boolean;
  error: string | null;
  rename: boolean;
  titleDraft: string | null;
  patch: Partial<Task> | null;
  expanded: boolean;
};
const emptyRowState: RowState = { busy: false, error: null, rename: false, titleDraft: null, patch: null, expanded: false };
const fieldCls = "h-11 w-full min-w-0 rounded-none border-0 bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70";
const touchFieldCls = "h-11 min-w-0 w-full max-w-full rounded-md border border-input bg-background px-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70";
const statusTone: Record<string, string> = {
  not_started: "bg-status-not_started/15",
  in_progress: "bg-status-in_progress/15",
  review: "bg-status-review/15",
  blocked: "bg-status-blocked/15",
  done: "bg-status-done/15",
};
const displayDate = (date: string | null) => date ? format(parseISO(date), "d MMM yyyy") : "Not set";
function displayOwner(id: string | null, people: ProjectPerson[]) {
  if (!id) return "Not assigned";
  const owner = people.find((person) => person.id === id);
  return owner?.full_name ?? owner?.email ?? "Assigned team member";
}
function saveError(error: unknown) {
  const detail = error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "Please try again.";
  return `Changes were not saved. ${detail}`;
}

type TableProps = Common & {
  documents?: Doc[];
  defaultStage?: string;
  onAdd: (stage: string, title: string, pos: number) => Promise<void>;
};

export function TableView({ tasks, people, canEdit, onOpen, onUpdate, onAdd, documents = [], defaultStage }: TableProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [showEmpty, setShowEmpty] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Drafts and pending writes live above the filtered rows so a filter or group collapse cannot discard them.
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const writeLocks = useRef(new Set<string>());
  const [addOpen, setAddOpen] = useState(false);
  const [addStage, setAddStage] = useState(STAGES.some((stage) => stage.key === defaultStage) ? defaultStage! : STAGES[0].key);
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const addLock = useRef(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addedMessage, setAddedMessage] = useState("");
  const addInput = useRef<HTMLInputElement>(null);
  const formId = useId();
  const groups = [...STAGES.map((stage) => ({ key: stage.key as string, label: stage.label as string })), ...Array.from(new Set(tasks.map((task) => task.stage))).filter((stage) => !STAGES.some((known) => known.key === stage)).map((stage) => ({ key: stage, label: stageLabel(stage) }))];
  const search = query.trim().toLocaleLowerCase();
  const filtered = tasks.filter((task) => (!search || `${task.title} ${task.description ?? ""} ${stageLabel(task.stage)} ${displayOwner(task.assignee_id, people)}`.toLocaleLowerCase().includes(search)) && (status === "all" || task.status === status));
  const hasFilter = !!search || status !== "all";
  const visibleGroups = groups.filter((stage) => filtered.some((task) => task.stage === stage.key) || (!hasFilter && showEmpty));

  useEffect(() => { if (addOpen && !adding) addInput.current?.focus(); }, [addOpen, adding]);

  function rowState(id: string) { return rowStates[id] ?? emptyRowState; }
  function changeRow(id: string, patch: Partial<RowState>) {
    setRowStates((states) => ({ ...states, [id]: { ...(states[id] ?? emptyRowState), ...patch } }));
  }
  async function save(task: Task, patch: Partial<Task>) {
    if (!canEdit || writeLocks.current.has(task.id)) return false;
    if (patch.title !== undefined && !patch.title.trim()) {
      changeRow(task.id, { error: "Enter a task name." });
      return false;
    }
    writeLocks.current.add(task.id);
    changeRow(task.id, { busy: true, error: null, patch });
    try {
      await onUpdate(task.id, patch);
      changeRow(task.id, { busy: false, error: null, patch: null, ...(patch.title !== undefined ? { rename: false, titleDraft: null } : {}) });
      return true;
    } catch (error) {
      changeRow(task.id, { busy: false, patch: null, error: saveError(error) });
      return false;
    } finally { writeLocks.current.delete(task.id); }
  }
  function showAdd(stage?: string) {
    if (stage && !adding) setAddStage(stage);
    setAddOpen(true);
    if (addOpen) addInput.current?.focus();
  }
  async function addTask(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit || addLock.current || !title.trim()) return;
    addLock.current = true;
    setAdding(true);
    setAddError(null);
    setAddedMessage("");
    try {
      const position = Math.max(-1, ...tasks.map((task) => Number.isFinite(task.position) ? task.position : -1)) + 1;
      await onAdd(addStage, title.trim(), position);
      setTitle("");
      setQuery("");
      setStatus("all");
      setCollapsed((groups) => ({ ...groups, [addStage]: false }));
      setAddedMessage(`Task added to ${stageLabel(addStage)}.`);
      addInput.current?.focus();
    } catch (error) { setAddError(saveError(error)); }
    finally { setAdding(false); addLock.current = false; }
  }
  const rowProps = (task: Task) => ({
    task, people, canEdit, onOpen, state: rowState(task.id),
    fileCount: documents.filter((document) => document.task_id === task.id).length,
    onSave: (patch: Partial<Task>) => save(task, patch),
    onState: (patch: Partial<RowState>) => changeRow(task.id, patch),
  });

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label="Task tools">
        {canEdit && <Button type="button" className="min-h-11" onClick={() => showAdd()} aria-expanded={addOpen} aria-controls={formId}><Plus className="h-4 w-4" />Add task</Button>}
        <div className="relative min-w-0 flex-1 basis-44 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
          <Input aria-label="Search tasks" placeholder="Search tasks" value={query} onChange={(event) => setQuery(event.target.value)} className="h-11 pl-9" />
        </div>
        <select aria-label="Filter tasks by status" value={status} onChange={(event) => setStatus(event.target.value)} className={cn(touchFieldCls, "w-auto max-w-full flex-1 basis-36 sm:flex-none sm:text-sm")}>
          <option value="all">All statuses</option>
          {STATUSES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground sm:ml-auto">
          <input type="checkbox" checked={showEmpty} onChange={(event) => setShowEmpty(event.target.checked)} className="h-4 w-4 accent-primary" />Empty stages
        </label>
      </div>
      {canEdit && <div id={formId} hidden={!addOpen} className="rounded-md border bg-card p-3">
        <form aria-label="Add a task" onSubmit={(event) => void addTask(event)} className="flex min-w-0 flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 basis-64 space-y-1 text-sm font-medium"><span>Task name</span><Input ref={addInput} disabled={adding} value={title} onChange={(event) => { setTitle(event.target.value); setAddedMessage(""); }} placeholder="What needs to be done?" required className="h-11" /></label>
          <label className="min-w-0 flex-1 basis-48 space-y-1 text-sm font-medium"><span>Stage</span><select aria-label="Stage" value={addStage} onChange={(event) => setAddStage(event.target.value)} disabled={adding} className={touchFieldCls}>{STAGES.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}</select></label>
          <Button type="submit" disabled={adding || !title.trim()} className="min-h-11">{adding ? "Adding..." : "Create task"}</Button>
          <Button type="button" variant="ghost" className="min-h-11" disabled={adding} onClick={() => setAddOpen(false)}>Close</Button>
        </form>
        {addError && <p role="alert" className="mt-2 text-sm text-destructive">{addError}</p>}
        {addedMessage && <p role="status" className="mt-2 text-sm">{addedMessage}</p>}
      </div>}
      <p className="text-xs text-muted-foreground" aria-live="polite">{hasFilter ? `${filtered.length} of ${tasks.length}` : tasks.length} {tasks.length === 1 ? "task" : "tasks"}</p>
      {visibleGroups.length === 0 && <div className="rounded-md border bg-card px-4 py-8 text-sm">
        <p>{tasks.length === 0 ? "No tasks yet." : "No tasks match your search or status filter."}</p>
        {hasFilter && <Button variant="outline" className="mt-3 min-h-11" onClick={() => { setQuery(""); setStatus("all"); }}>Clear filters</Button>}
      </div>}
      {visibleGroups.map((stage) => {
        const rows = filtered.filter((task) => task.stage === stage.key);
        const allRows = tasks.filter((task) => task.stage === stage.key);
        const done = allRows.filter((task) => task.status === "done").length;
        const isCollapsed = !!collapsed[stage.key];
        const canAddToStage = canEdit && STAGES.some((known) => known.key === stage.key);
        const contentId = `${formId}-${stage.key}`;
        return <section key={stage.key} aria-label={`${stage.label} tasks`} className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 border-b">
            <button type="button" aria-expanded={!isCollapsed} aria-controls={contentId} onClick={() => setCollapsed((groups) => ({ ...groups, [stage.key]: !isCollapsed }))} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {isCollapsed ? <ChevronRight className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}<span className="min-w-0 [overflow-wrap:anywhere]">{stage.label}</span><span className="shrink-0 text-xs font-normal text-muted-foreground">{done}/{allRows.length} done</span>
            </button>
            {canAddToStage && <button type="button" aria-label={`Add task to ${stage.label}`} onClick={() => showAdd(stage.key)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Plus className="h-4 w-4" /></button>}
          </div>
          <div id={contentId} hidden={isCollapsed}>
            <div className="md:hidden"><div role="list" aria-label={`${stage.label} task list`} className="divide-y border-x border-b bg-card">{rows.map((task) => <TaskListItem key={task.id} {...rowProps(task)} />)}</div></div>
            <div role="region" aria-label={`${stage.label} task sheet`} tabIndex={0} className="hidden max-w-full overflow-x-auto overscroll-x-contain border-x border-b bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:block">
              <table className="w-full min-w-[1020px] table-fixed text-sm">
                <colgroup><col className="w-[340px]" /><col className="w-[140px]" /><col className="w-[160px]" /><col className="w-[140px]" /><col className="w-[140px]" /><col className="w-[100px]" /></colgroup>
                <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground"><tr><th scope="col" className="sticky left-0 z-10 border-r bg-muted px-3 py-2 font-medium">Task</th><th scope="col" className="border-r px-2 py-2 font-medium">Status</th><th scope="col" className="border-r px-2 py-2 font-medium">Owner</th><th scope="col" className="border-r px-2 py-2 font-medium">Due date</th><th scope="col" className="border-r px-2 py-2 font-medium">Start date</th><th scope="col" className="px-2 py-2 font-medium">Priority</th></tr></thead>
                <tbody>{rows.map((task) => <TaskTableRow key={task.id} {...rowProps(task)} />)}</tbody>
              </table>
            </div>
            {rows.length === 0 && <p className="border-x border-b bg-card p-3 text-sm text-muted-foreground">No tasks in this stage.</p>}
            {canAddToStage && <button type="button" onClick={() => showAdd(stage.key)} aria-label={`Add another task to ${stage.label}`} className="flex min-h-11 w-full items-center gap-2 border-x border-b bg-card px-3 text-left text-sm text-muted-foreground hover:bg-muted"><Plus className="h-4 w-4" />Add task</button>}
          </div>
        </section>;
      })}
    </div>
  );
}

type RowProps = {
  task: Task;
  people: ProjectPerson[];
  canEdit: boolean;
  onOpen: Common["onOpen"];
  state: RowState;
  fileCount: number;
  onSave: (patch: Partial<Task>) => Promise<boolean>;
  onState: (patch: Partial<RowState>) => void;
};

function TaskName({ task, canEdit, onOpen, state, onSave, onState }: RowProps) {
  const titleInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (state.rename && titleInput.current?.getClientRects().length) titleInput.current.focus(); }, [state.rename]);
  return <div className="min-w-0">
    {canEdit && state.rename ? <form aria-label={`Rename ${task.title}`} className="flex min-w-0 flex-wrap gap-1 py-1" onSubmit={(event) => { event.preventDefault(); void onSave({ title: (state.titleDraft ?? task.title).trim() }); }}>
      <Input ref={titleInput} aria-label={`Task name for ${task.title}`} value={state.titleDraft ?? task.title} disabled={state.busy} onChange={(event) => onState({ titleDraft: event.target.value })} onKeyDown={(event) => { if (event.key === "Escape" && !state.busy) { event.preventDefault(); onState({ rename: false, titleDraft: null, error: null }); } }} className="h-11 min-w-0 flex-1 basis-full" />
      <Button type="submit" variant="outline" className="min-h-11" disabled={state.busy}>{state.busy ? "Saving..." : "Save name"}</Button><Button type="button" variant="ghost" className="min-h-11" disabled={state.busy} onClick={() => onState({ rename: false, titleDraft: null, error: null })}>Cancel</Button>
    </form> : <div className="flex min-w-0 items-center gap-1"><button type="button" onClick={() => onOpen(task)} className="min-h-11 min-w-0 flex-1 py-2 text-left font-medium [overflow-wrap:anywhere] hover:text-oak focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{task.title}</button>{canEdit && <button type="button" aria-label={`Rename ${task.title}`} disabled={state.busy} onClick={() => onState({ rename: true, titleDraft: task.title, error: null })} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Pencil className="h-3.5 w-3.5" /></button>}</div>}
    {state.busy && !state.rename && <p role="status" className="pb-1 text-xs text-muted-foreground">Saving...</p>}
    {state.error && <p role="alert" className="pb-2 text-xs text-destructive">{state.error}</p>}
  </div>;
}

function RowUpdates({ task, onOpen, fileCount }: Pick<RowProps, "task" | "onOpen" | "fileCount">) {
  return <div className="flex items-center justify-end">
    <button type="button" aria-label={`Comments for ${task.title}`} title="Comments" onClick={() => onOpen(task, "comments")} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MessageSquare className="h-4 w-4" /></button>
    <button type="button" aria-label={`Files for ${task.title}${fileCount ? ` (${fileCount})` : ""}`} title="Files" onClick={() => onOpen(task, "files")} className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md px-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Paperclip className="h-4 w-4" />{fileCount > 0 && <span className="text-xs">{fileCount}</span>}</button>
  </div>;
}

function StatusField({ task, canEdit, state, onSave, mobile = false }: Pick<RowProps, "task" | "canEdit" | "state" | "onSave"> & { mobile?: boolean }) {
  const current = { ...task, ...state.patch };
  return canEdit ? <select aria-label={`Status for ${task.title}`} disabled={state.busy} className={cn(mobile ? touchFieldCls : fieldCls, statusTone[current.status])} value={current.status} onChange={(event) => void onSave({ status: event.target.value })}>{STATUSES.map((status) => <option key={status.key} value={status.key}>{status.label}</option>)}</select> : <span className={cn("flex min-h-11 items-center px-2 font-medium", statusTone[task.status])}>{statusLabel(task.status)}</span>;
}

function OwnerField({ task, people, canEdit, state, onSave, mobile = false }: Pick<RowProps, "task" | "people" | "canEdit" | "state" | "onSave"> & { mobile?: boolean }) {
  const current = { ...task, ...state.patch };
  return canEdit ? <select aria-label={`Owner for ${task.title}`} disabled={state.busy} className={mobile ? touchFieldCls : fieldCls} value={current.assignee_id ?? ""} onChange={(event) => void onSave({ assignee_id: event.target.value || null })}><option value="">Not assigned</option>{current.assignee_id && !people.some((person) => person.id === current.assignee_id) && <option value={current.assignee_id}>Assigned team member</option>}{people.map((person) => <option key={person.id} value={person.id}>{person.full_name ?? person.email}</option>)}</select> : <span className="block px-2 py-2 [overflow-wrap:anywhere]">{displayOwner(task.assignee_id, people)}</span>;
}

function PriorityField({ task, canEdit, state, onSave, mobile = false }: Pick<RowProps, "task" | "canEdit" | "state" | "onSave"> & { mobile?: boolean }) {
  const current = { ...task, ...state.patch };
  return canEdit ? <select aria-label={`Priority for ${task.title}`} disabled={state.busy} className={mobile ? touchFieldCls : fieldCls} value={current.priority} onChange={(event) => void onSave({ priority: event.target.value })}>{PRIORITIES.map((priority) => <option key={priority.key} value={priority.key}>{priority.label}</option>)}</select> : <span className="block px-2 py-2">{PRIORITIES.find((priority) => priority.key === task.priority)?.label ?? task.priority}</span>;
}

function DateField({ task, canEdit, state, onSave, field, mobile = false }: Pick<RowProps, "task" | "canEdit" | "state" | "onSave"> & { field: "start_date" | "due_date"; mobile?: boolean }) {
  const current = { ...task, ...state.patch };
  const overdue = field === "due_date" && isTaskOverdue(current);
  return canEdit ? <input aria-label={`${field === "due_date" ? "Due" : "Start"} date for ${task.title}`} type="date" disabled={state.busy} className={cn(mobile ? touchFieldCls : fieldCls, overdue && "text-destructive")} value={current[field] ?? ""} onChange={(event) => void onSave({ [field]: event.target.value || null })} /> : <span className={cn("block px-2 py-2", overdue && "text-destructive")}>{displayDate(task[field])}{overdue && <span className="ml-1 text-xs">Overdue</span>}</span>;
}

function TaskTableRow(props: RowProps) {
  return <tr className="border-b last:border-b-0 hover:bg-muted/20" aria-busy={props.state.busy}>
    <td className="sticky left-0 z-10 border-r bg-card pl-3 align-top"><div className="flex min-w-0 items-start"><div className="min-w-0 flex-1"><TaskName {...props} /></div><RowUpdates {...props} /></div></td>
    <td className={cn("border-r p-0 align-top", statusTone[(props.state.patch?.status ?? props.task.status)])}><StatusField {...props} /></td>
    <td className="border-r p-0 align-top"><OwnerField {...props} /></td>
    <td className="border-r p-0 align-top"><DateField {...props} field="due_date" /></td>
    <td className="border-r p-0 align-top"><DateField {...props} field="start_date" /></td>
    <td className="p-0 align-top"><PriorityField {...props} /></td>
  </tr>;
}

function TaskListItem(props: RowProps) {
  const { task, state, onState } = props;
  return <div role="listitem" className="min-w-0 px-3 py-2" aria-busy={state.busy}>
    <TaskName {...props} />
    <div className="grid min-w-0 grid-cols-2 gap-2">
      <div className="min-w-0"><span className="mb-1 block text-xs text-muted-foreground">Status</span><StatusField {...props} mobile /></div>
      <div className="min-w-0"><span className="mb-1 block text-xs text-muted-foreground">Due date</span><DateField {...props} field="due_date" mobile /></div>
    </div>
    <div className="flex min-w-0 items-center gap-1"><span className="min-w-0 flex-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{displayOwner(task.assignee_id, props.people)}</span><RowUpdates {...props} /><button type="button" aria-label={`${state.expanded ? "Hide" : "Show"} more fields for ${task.title}`} aria-expanded={state.expanded} onClick={() => onState({ expanded: !state.expanded })} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{state.expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button></div>
    {state.expanded && <div className="grid min-w-0 grid-cols-1 gap-3 border-t py-3 min-[420px]:grid-cols-2">
      <div className="min-w-0"><span className="mb-1 block text-xs text-muted-foreground">Owner</span><OwnerField {...props} mobile /></div>
      <div className="min-w-0"><span className="mb-1 block text-xs text-muted-foreground">Start date</span><DateField {...props} field="start_date" mobile /></div>
      <div className="min-w-0"><span className="mb-1 block text-xs text-muted-foreground">Priority</span><PriorityField {...props} mobile /></div>
    </div>}
  </div>;
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
