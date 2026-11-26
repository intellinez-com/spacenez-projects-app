import { MoreHorizontal, ArrowUp, ArrowDown, Pencil, Trash2 } from "lucide-react";
import type { StageDefinition } from "@/lib/constants";
import type { ProjectStageMutations } from "@/lib/project-stages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type HeadingDialog =
  | { kind: "add"; label: string; version: number }
  | { kind: "rename"; key: string; label: string; version: number }
  | { kind: "archive"; key: string; destination: string; version: number };

export function ProjectHeadingActions({ label, disabled, first, last, only, onRename, onRemove, onMove }: {
  label: string; disabled: boolean; first: boolean; last: boolean; only: boolean;
  onRename: () => void; onRemove: () => void; onMove: (direction: -1 | 1) => void;
}) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><button type="button" disabled={disabled} aria-label={`Heading options for ${label}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
      <DropdownMenuItem className="min-h-11" onSelect={onRename}><Pencil />Rename heading</DropdownMenuItem>
      <DropdownMenuItem className="min-h-11" disabled={first} onSelect={() => onMove(-1)}><ArrowUp />Move up</DropdownMenuItem>
      <DropdownMenuItem className="min-h-11" disabled={last} onSelect={() => onMove(1)}><ArrowDown />Move down</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" disabled={only} onSelect={onRemove}><Trash2 />Remove heading</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function ProjectHeadingsManager({ dialog, onDialogChange, mutation, stages, tasks, currentStage, version }: {
  dialog: HeadingDialog | null;
  onDialogChange: (dialog: HeadingDialog | null) => void;
  mutation: ProjectStageMutations;
  stages: readonly StageDefinition[];
  tasks: readonly { stage: string }[];
  currentStage: string;
  version: number;
}) {
  const target = dialog && dialog.kind !== "add" ? stages.find((stage) => stage.key === dialog.key) : undefined;
  const taskCount = target ? tasks.filter((task) => task.stage === target.key).length : 0;
  const needsDestination = !!target && (taskCount > 0 || currentStage === target.key);
  const others = stages.filter((stage) => stage.key !== target?.key);
  const validLabel = dialog && dialog.kind !== "archive" && dialog.label.trim().length > 0;
  const invalidTarget = dialog?.kind !== "add" && !target;
  const valid = !!dialog && (dialog.kind === "archive" ? !invalidTarget && stages.length > 1 && (!needsDestination || others.some((stage) => stage.key === dialog.destination)) : !!validLabel && !invalidTarget);

  function reviewCurrent() {
    if (dialog) onDialogChange({ ...dialog, version });
    mutation.clearError();
  }
  function errorControls() {
    if (!mutation.error) return null;
    return <div role="alert" className="space-y-2 border border-destructive/30 p-3 text-sm">
      <p>{mutation.error.message}</p>
      {mutation.pending && <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-11 whitespace-normal" disabled={mutation.busy} onClick={() => void mutation.retry()}>{mutation.error.saved ? "Retry refresh" : "Retry same change"}</Button>
        {mutation.error.definite && <Button type="button" variant="ghost" className="min-h-11 whitespace-normal" onClick={mutation.discardRejected}>Edit rejected change</Button>}
      </div>}
      {mutation.error.conflict && <Button type="button" variant="outline" className="min-h-11 whitespace-normal" onClick={reviewCurrent}>Use refreshed headings</Button>}
    </div>;
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!dialog || !valid || mutation.disabled || mutation.error?.conflict) return;
    if (dialog.kind === "add") await mutation.mutate({ type: "add", label: dialog.label.trim() }, dialog.version);
    else if (dialog.kind === "rename") await mutation.mutate({ type: "rename", key: dialog.key, label: dialog.label.trim() }, dialog.version);
    else await mutation.mutate({ type: "archive", key: dialog.key, ...(needsDestination ? { move_to: dialog.destination } : {}) }, dialog.version);
  }

  return <>
    {!dialog && errorControls()}
    <Dialog open={!!dialog} onOpenChange={(open) => { if (!open && !mutation.busy) onDialogChange(null); }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden [overflow-wrap:anywhere]">
        <DialogHeader className="max-h-[30dvh] shrink-0 overflow-y-auto pr-6">
          <DialogTitle>{dialog?.kind === "add" ? "Add heading" : dialog?.kind === "rename" ? "Rename heading" : "Remove heading"}</DialogTitle>
          <DialogDescription>{dialog?.kind === "archive" ? "Choose where any work and the current project stage should continue." : "Headings group the tasks in this project."}</DialogDescription>
        </DialogHeader>
        {dialog && <form aria-label={`${dialog.kind === "add" ? "Add" : dialog.kind === "rename" ? "Rename" : "Remove"} project heading`} onSubmit={(event) => void submit(event)} className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {dialog.kind !== "archive" ? <div className="space-y-2">
            {dialog.kind === "rename" && target && <p className="text-sm text-muted-foreground">Current heading: {target.label}</p>}
            <Label htmlFor="project-heading-name">Heading name</Label>
            <Input id="project-heading-name" autoFocus required maxLength={120} disabled={mutation.disabled} value={dialog.label} onChange={(event) => onDialogChange({ ...dialog, label: event.target.value })} placeholder="For example, Kitchen installation" className="min-h-11" />
            {dialog.kind === "rename" && <p className="text-sm text-muted-foreground">Tasks stay in this heading. Earlier activity and approvals retain their recorded names.</p>}
          </div> : <div className="space-y-3 text-sm">
            <p>Remove <strong>{target?.label ?? "this heading"}</strong> from this project?</p>
            <p>{taskCount === 0 ? "There are no tasks in this heading." : `${taskCount} ${taskCount === 1 ? "task must move" : "tasks must move"} to another heading. No tasks will be deleted.`}</p>
            {currentStage === dialog.key && <p>This is the current project stage. Choose the stage the project should continue in.</p>}
            {needsDestination && <div className="space-y-2"><Label htmlFor="project-heading-destination">{taskCount ? "Move tasks to" : "Continue project in"}</Label><select id="project-heading-destination" className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-base" required disabled={mutation.disabled} value={dialog.destination} onChange={(event) => onDialogChange({ ...dialog, destination: event.target.value })}><option value="">Choose another heading</option>{others.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}</select></div>}
            {taskCount > 0 && <p className="text-muted-foreground">Moving tasks changes their stage. Existing client review requests may need to be sent again.</p>}
            {stages.length < 2 && <p className="text-destructive">At least one heading must remain.</p>}
          </div>}
          {invalidTarget && <p role="alert" className="text-sm text-destructive">This heading is no longer active. Close this window and review the current headings.</p>}
          {errorControls()}
          {mutation.busy && <p role="status" className="text-sm text-muted-foreground">Saving heading change...</p>}
          <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={mutation.busy} onClick={() => onDialogChange(null)}>Close</Button><Button type="submit" variant={dialog.kind === "archive" ? "destructive" : "default"} className="min-h-11" disabled={!valid || mutation.disabled || !!mutation.error?.conflict}>{dialog.kind === "archive" ? "Remove heading" : dialog.kind === "add" ? "Add heading" : "Save heading name"}</Button></div>
        </form>}
      </DialogContent>
    </Dialog>
  </>;
}
