import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyStatus, type DailyStatusProps } from "./DailyStatus";
import { projectActivityBounds, projectDay, type ActivityPeriod, type ProjectActivity } from "@/lib/project-activity";
import type { Doc, Task } from "./data";

const mocks = vi.hoisted(() => ({ load: vi.fn(), tracking: vi.fn(), from: vi.fn(), openDoc: vi.fn() }));
vi.mock("@/lib/project-activity", async (original) => ({ ...await original<typeof import("@/lib/project-activity")>(), loadProjectActivity: mocks.load, loadActivityTracking: mocks.tracking }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("./data", async (original) => ({ ...await original<typeof import("./data")>(), openDoc: mocks.openDoc }));

const clients: QueryClient[] = [];
let records: ProjectActivity[];
const today = () => projectDay();
function day(offset: number) { return projectDay(new Date(new Date(`${today()}T12:00:00+05:30`).getTime() + offset * 86_400_000)); }
function activity(overrides: Partial<ProjectActivity> = {}): ProjectActivity {
  return { id: "activity-a", project_id: "project-a", actor_id: "editor-a", kind: "task_updated", occurred_at: new Date(`${today()}T11:00:00+05:30`).toISOString(), source_type: "tasks", source_id: "task-a", task_id: "task-a", payload: { title: "Kitchen measurements", changes: { status: { from: "in_progress", to: "done" } } }, author: { full_name: "Sample Designer", email: "designer@example.test" }, ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks(); records = [];
  mocks.tracking.mockResolvedValue({ started_at: `${day(-1)}T12:00:00+05:30` });
  mocks.load.mockImplementation(async (projectId: string, options: { period: ActivityPeriod; offset?: number; limit?: number; now?: Date }) => {
    const bounds = projectActivityBounds(options.period, options.now);
    return records.filter((row) => row.project_id === projectId && new Date(row.occurred_at).getTime() < new Date(bounds.to).getTime() && (!bounds.from || new Date(row.occurred_at).getTime() >= new Date(bounds.from).getTime())).sort((left, right) => new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime()).slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 50));
  });
});
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); clients.length = 0; vi.useRealTimers(); });

function renderStatus(overrides: Partial<DailyStatusProps> = {}) {
  const props: DailyStatusProps = { projectId: "project-a", tasks: [], documents: [], canEdit: false, onOpenTask: vi.fn(), onOpenFiles: vi.fn(), onOpenUpdates: vi.fn(), ...overrides };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><DailyStatus {...props} /></QueryClientProvider>);
  return { props, client };
}

describe("Automatic client daily status", () => {
  it.each([{ actor_id: null, actor: "System" }, { actor_id: "known-user", actor: "Project member" }])("does not invent a person's identity when the recorded actor is $actor", async ({ actor_id, actor }) => {
    records = [activity({ actor_id, author: null })];
    renderStatus();
    expect(await screen.findByText(/marked Kitchen measurements as Completed/)).toHaveTextContent(`${actor} marked Kitchen measurements as Completed.`);
    expect(screen.queryByText("Spacenez team")).not.toBeInTheDocument();
  });

  it("shows recorded status changes automatically, with actor, before/after status, and an existing task link", async () => {
    records = [activity(), activity({ id: "upload", kind: "document_added", source_type: "documents", source_id: "file-a", task_id: null, payload: { name: "Kitchen layout.pdf" } }), activity({ id: "comment", kind: "comment_added", source_type: "comments", source_id: "comment-a", task_id: null, author: { full_name: "Sample Client", email: "client@example.test" }, payload: { body: "Please confirm the cabinet depth." } })];
    const tasks = [{ id: "task-a", project_id: "project-a", title: "Kitchen measurements", status: "done", due_date: null, position: 0 }] as Task[];
    const { props } = renderStatus({ tasks });
    expect(screen.getByRole("button", { name: "Today", pressed: true })).toBeInTheDocument();
    expect(await screen.findByText(/marked Kitchen measurements as Completed/)).toHaveTextContent("Sample Designer marked Kitchen measurements as Completed.");
    expect(screen.getByText("Status: In progress → Completed")).toBeInTheDocument();
    expect(screen.getByText(/1 task marked complete/)).toHaveTextContent("1 task status change");
    expect(screen.getByText(/1 task marked complete/)).toHaveTextContent("1 file shared");
    expect(screen.getByText(/1 task marked complete/)).toHaveTextContent("1 comment");
    expect(screen.getByText("Please confirm the cabinet depth.")).toBeInTheDocument();
    expect(screen.getByText(/left a project comment/)).toHaveTextContent("Sample Client left a project comment.");
    fireEvent.click(screen.getByRole("button", { name: "Open task" }));
    expect(props.onOpenTask).toHaveBeenCalledWith(tasks[0]);
    expect(screen.queryByRole("button", { name: "Post daily update" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Work done / progress")).not.toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(await screen.findByText(/Detailed change history starts/)).toBeInTheDocument();
  });

  it("distinguishes an empty activity day from the latest change and keeps current task totals overall", async () => {
    records = [activity({ occurred_at: new Date(`${day(-1)}T11:00:00+05:30`).toISOString() })];
    const tasks = [
      { id: "done", project_id: "project-a", title: "Survey", status: "done", position: 0, due_date: null, updated_at: new Date().toISOString() },
      { id: "blocked", project_id: "project-a", title: "Select kitchen finish", status: "blocked", position: 1, due_date: day(-1) },
      { id: "foreign", project_id: "other-project", title: "Private work", status: "done", position: 0, due_date: null },
    ] as Task[];
    renderStatus({ tasks });
    expect(await screen.findByText("No activity recorded today.")).toBeInTheDocument();
    expect(screen.getByText("Latest earlier update")).toBeInTheDocument();
    expect(screen.getByText(/marked Kitchen measurements as Completed/)).toBeInTheDocument();
    expect(screen.getByText("Overall progress so far")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 (50%)")).toBeInTheDocument();
    expect(screen.queryByText(/marked complete$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no work happened/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Private work")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See previous activity" }));
    expect(screen.getByRole("button", { name: "So far", pressed: true })).toBeInTheDocument();
  });

  it("filters the week and complete history by event date rather than the task's current status", async () => {
    records = [activity(), activity({ id: "old", occurred_at: new Date(`${day(-8)}T10:00:00+05:30`).toISOString(), kind: "task_updated", payload: { title: "Original floor plan", changes: { due_date: { from: null, to: "2026-12-01" } } } })];
    renderStatus(); await screen.findByText(/marked Kitchen measurements as Completed/);
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith("project-a", expect.objectContaining({ period: "week", offset: 0, limit: 50 })));
    expect(screen.queryByText(/updated the dates for Original floor plan/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "So far" }));
    expect(await screen.findByText(/updated the dates for Original floor plan/)).toBeInTheDocument();
    expect(screen.getByText("Due date: Not set → 1 Dec 2026")).toBeInTheDocument();
  });

  it("uses India midnight for uploaded files and opens only existing private files from this project", async () => {
    records = [activity({ id: "upload", kind: "document_added", source_type: "documents", source_id: "today-file", task_id: null, payload: { name: "Kitchen photo.jpg" } }), activity({ id: "removed", kind: "document_removed", source_type: "documents", source_id: "removed-file", task_id: null, payload: { name: "Removed file.jpg" } })];
    const documents = [
      { id: "today-file", project_id: "project-a", name: "Kitchen photo.jpg", path: "project-a/today.jpg", created_at: `${today()}T00:10:00+05:30`, size: 100 },
      { id: "yesterday", project_id: "project-a", name: "Old photo.jpg", path: "project-a/yesterday.jpg", created_at: `${day(-1)}T23:59:00+05:30`, size: 100 },
      { id: "foreign", project_id: "other-project", name: "Other project.jpg", path: "other-project/private.jpg", created_at: `${today()}T01:00:00+05:30`, size: 100 },
      { id: "badpath", project_id: "project-a", name: "Unrelated file.jpg", path: "other-project/file.jpg", created_at: `${today()}T01:00:00+05:30`, size: 100 },
    ] as Doc[];
    const { props } = renderStatus({ documents });
    await screen.findByText(/shared Kitchen photo.jpg/);
    expect(screen.getByRole("heading", { name: "Files shared today" })).toBeInTheDocument();
    expect(screen.queryByText("Old photo.jpg")).not.toBeInTheDocument();
    expect(screen.queryByText("Other project.jpg")).not.toBeInTheDocument();
    expect(screen.queryByText("Unrelated file.jpg")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Open file" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    expect(mocks.openDoc).toHaveBeenCalledWith("project-a/today.jpg");
    fireEvent.click(screen.getByRole("button", { name: "All photos & files" }));
    expect(props.onOpenFiles).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "So far" }));
    expect(screen.getByText("Old photo.jpg")).toBeInTheDocument();
  });

  it("retains optional existing notes and approval feedback as clearly labelled content", async () => {
    records = [activity({ id: "note", kind: "team_note", source_type: "project_daily_updates", source_id: "note-a", task_id: null, payload: { work_done: "Vendor arrived late.", next_steps: "Confirm tomorrow's arrival.", blockers: "Awaiting delivery.", report_date: day(-1), historical: true } }), activity({ id: "approval", kind: "approval_changes_requested", source_type: "task_approvals", source_id: "approval-a", task_id: "task-a", payload: { task_title: "Furniture layout", feedback: "Move the sofa towards the window." } })];
    const { props } = renderStatus({ canEdit: true });
    expect(await screen.findByText(/shared a project note/)).toBeInTheDocument();
    expect(screen.getByText("Note")).toBeInTheDocument();
    expect(screen.getByText("Vendor arrived late.")).toBeInTheDocument();
    expect(screen.getByText("Earlier record")).toBeInTheDocument();
    expect(screen.getByText(/requested changes to Furniture layout/)).toBeInTheDocument();
    expect(screen.getByText("Feedback")).toBeInTheDocument();
    expect(screen.getByText("Move the sofa towards the window.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    expect(props.onOpenUpdates).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Share with client" })).not.toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("keeps cached activity readable when refreshing fails and permits retry", async () => {
    records = [activity()];
    const { client } = renderStatus();
    await screen.findByText(/marked Kitchen measurements as Completed/);
    mocks.load.mockRejectedValue(new Error("Connection unavailable"));
    await act(async () => { await client.invalidateQueries({ queryKey: ["project-activity"] }); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Project activity could not be refreshed. Showing the available updates.");
    expect(screen.getByText(/marked Kitchen measurements as Completed/)).toBeInTheDocument();
    mocks.load.mockResolvedValue([activity()]);
    fireEvent.click(await screen.findByRole("button", { name: "Retry activity" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry activity" })).not.toBeInTheDocument());
    expect(screen.getByText(/marked Kitchen measurements as Completed/)).toBeInTheDocument();
  });

  it("pages earlier activity and labels the summary as the displayed page", async () => {
    records = Array.from({ length: 51 }, (_, index) => activity({ id: `activity-${index}`, occurred_at: new Date(`${day(-1 - index)}T11:00:00+05:30`).toISOString(), payload: { title: `Task ${index}`, changes: { status: { from: "not_started", to: "in_progress" } } } }));
    renderStatus(); await screen.findByText("No activity recorded today.");
    fireEvent.click(screen.getByRole("button", { name: "So far" }));
    expect(await screen.findByText("50 recorded updates on this page")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Older activity" }));
    expect(await screen.findByText(/marked Task 50 as In progress/)).toBeInTheDocument();
    expect(mocks.load).toHaveBeenCalledWith("project-a", expect.objectContaining({ period: "all", offset: 50, limit: 50 }));
    expect(screen.getByRole("button", { name: "Newer activity" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Older activity" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Daily status" })).queryByText(/marked Task 0 as In progress/)).not.toBeInTheDocument();
  });

  it("moves an open Today view to the new India day without inferring activity from task totals", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T23:59:00+05:30"));
    records = [activity({ payload: { title: "Evening measurements", changes: { status: { from: "in_progress", to: "done" } } } })];
    renderStatus(); await screen.findByText(/marked Evening measurements as Completed/);
    vi.setSystemTime(new Date("2026-11-21T00:01:00+05:30"));
    records.push(activity({ id: "new-day", occurred_at: new Date("2026-11-21T00:00:30+05:30").toISOString(), payload: { title: "New day inspection", changes: { status: { from: "not_started", to: "in_progress" } } } }));
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(await screen.findByText(/marked New day inspection as In progress/)).toBeInTheDocument();
    expect(screen.queryByText(/marked Evening measurements as Completed/)).not.toBeInTheDocument();
    expect(screen.getByText("Today · 21 Nov 2026 · India time")).toBeInTheDocument();
  });
});
