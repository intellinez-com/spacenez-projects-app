import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Section = { value: string; label: string };
type Props = {
  value: string;
  canEdit: boolean;
  isAdmin: boolean;
  onChange: (value: string) => void;
};

export function ProjectNavigation({ value, canEdit, isAdmin, onChange }: Props) {
  const tasks = { value: "table", label: "Tasks" };
  const progress = { value: "daily", label: "Progress" };
  const primary: Section[] = [
    ...(canEdit ? [tasks, progress] : [progress, tasks]),
    { value: "files", label: "Photos & files" },
    { value: "approvals", label: "Approvals" },
  ];
  const secondary: Section[] = [
    { value: "updates", label: "Project discussion" },
    { value: "overview", label: "Project summary" },
    { value: "details", label: "Project details" },
    ...(isAdmin ? [{ value: "team", label: "Team & access" }, { value: "payments", label: "Payments" }] : []),
  ];
  const alternateViews = canEdit ? [{ value: "board", label: "Board view" }, { value: "timeline", label: "Timeline view" }] : [];
  const selectedSecondary = [...secondary, ...alternateViews].find((section) => section.value === value);
  const menuItem = (section: Section) => <DropdownMenuItem key={section.value} className="min-h-11" onSelect={() => onChange(section.value)}>
    <span className="flex-1">{section.label}</span>{value === section.value && <Check aria-hidden="true" className="h-4 w-4" />}
  </DropdownMenuItem>;

  return <>
    <nav aria-label="Project sections" className="flex min-w-0 items-start gap-2 border-b sm:items-center">
      <div className="grid min-w-0 flex-1 grid-cols-2 sm:flex sm:flex-wrap">
        {primary.map((section) => <button key={section.value} type="button" aria-current={value === section.value ? "page" : undefined} onClick={() => onChange(section.value)} className={cn("min-h-11 min-w-0 border-b-2 border-transparent px-2 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4", value === section.value ? "border-primary font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground")}>
          {section.label}
        </button>)}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" className={cn("min-h-11 shrink-0 px-2 sm:px-3", selectedSecondary && "bg-muted")} aria-label="More project options">More <ChevronDown aria-hidden="true" className="h-4 w-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 max-w-[calc(100vw-2rem)]">
          {secondary.map(menuItem)}
          {alternateViews.length > 0 && <><DropdownMenuSeparator /><DropdownMenuLabel>Other task views</DropdownMenuLabel>{alternateViews.map(menuItem)}</>}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
    {selectedSecondary && <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{selectedSecondary.label}</h2><Button type="button" variant="outline" className="min-h-11" onClick={() => onChange(canEdit ? "table" : "daily")}>{canEdit ? "Back to tasks" : "Back to progress"}</Button></div>}
  </>;
}
