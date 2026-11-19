import { cn } from "@/lib/utils";
import { STAGES, statusLabel } from "@/lib/constants";

const dot: Record<string, string> = {
  not_started: "bg-status-not_started",
  in_progress: "bg-status-in_progress",
  review: "bg-status-review",
  blocked: "bg-status-blocked",
  done: "bg-status-done",
};

export function statusBg(status: string) {
  return dot[status] ?? dot["not_started"];
}

export function StatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium", className)}>
      <span className={cn("h-2 w-2 rounded-full", statusBg(status))} />
      {statusLabel(status)}
    </span>
  );
}

export function StageTrack({ current }: { current: number }) {
  return (
    <div className="flex gap-0.5">
      {STAGES.map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 flex-1 rounded-full",
            i < current ? "bg-status-done" : i === current ? "bg-oak" : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}
