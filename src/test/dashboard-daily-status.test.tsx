import type { ComponentType, ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectActivity } from "@/lib/project-activity";

const mocks = vi.hoisted(() => ({ from: vi.fn(), loadLatest: vi.fn(), admin: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/lib/auth", () => ({ useMe: () => ({ data: { id: "viewer", isAdmin: mocks.admin } }) }));
vi.mock("@/lib/project-activity", () => ({ loadLatestProjectActivity: mocks.loadLatest }));
vi.mock("@/lib/daily-updates", async (original) => {
  const actual = await original<typeof import("@/lib/daily-updates")>();
  return { ...actual, projectDay: (now = new Date("2026-11-20T12:00:00+05:30")) => actual.projectDay(now) };
});
vi.mock("@/components/project/ProjectImportDialog", () => ({ ProjectImportDialog: () => null }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ to, params, children, ...props }: { to: string; params?: Record<string, string>; children?: ReactNode }) => <a href={to.replace("$id", params?.["id"] ?? "")} {...props}>{children}</a>,
}));

import { Route } from "@/routes/_authenticated/dashboard";
const Dashboard = Route.options.component as ComponentType;
const clients: QueryClient[] = [];
const event: ProjectActivity = {
  id: "event-a", project_id: "project-a", actor_id: "designer", occurred_at: "2026-11-20T10:00:00Z",
  source_type: "tasks", source_id: "task-a", task_id: "task-a", kind: "task_updated",
  payload: { title: "Kitchen measurements", changes: { status: { from: "in_progress", to: "done" } } },
  author: { full_name: "Designer", email: "designer@example.test" },
};

beforeEach(() => {
  vi.resetAllMocks(); mocks.admin = false;
  mocks.from.mockImplementation((table: string) => {
    if (table === "projects") return { select: () => ({ order: async () => ({ data: [{
      id: "project-a", name: "Sample interior project", project_type: "Commercial", client_name: "Sample Client", location: "Sample site",
      target_date: null, current_stage: "layout_2d", status: "active", created_at: "2026-11-01T00:00:00Z",
    }], error: null }) }) };
    if (table === "tasks") return { select: async () => ({ data: [{ id: "task-a", project_id: "project-a", status: "done", due_date: null, updated_at: "2026-11-20T09:00:00Z" }], error: null }) };
    if (table === "project_stages") return { select: () => ({ order: async () => ({ data: [{ project_id: "project-a", key: "layout_2d", label: "Space planning", position: 0, archived_at: null }], error: null }) }) };
    throw new Error(`Unexpected table ${table}`);
  });
  mocks.loadLatest.mockResolvedValue({ "project-a": event });
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><Dashboard /></QueryClientProvider>);
  return client;
}

describe("Daily status on the client dashboard", () => {
  it("puts the actual status-change event on the project entry and keeps admin totals out of the client view", async () => {
    renderDashboard();
    expect(screen.getByRole("heading", { name: "Your project updates" })).toBeInTheDocument();
    expect(await screen.findByText(/Kitchen measurements/)).toHaveTextContent(/Completed/i);
    expect(screen.getByText("Today’s activity")).toBeInTheDocument();
    expect(screen.getByText("Designer", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open daily status for Sample interior project" })).toHaveAttribute("href", "/projects/project-a");
    expect(screen.getByText("Space planning")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duplicate project" })).not.toBeInTheDocument();
    expect(screen.getByText("Open daily status →")).toBeInTheDocument();
    expect(screen.queryByText("Active projects")).not.toBeInTheDocument();
    expect(screen.queryByText("Open tasks")).not.toBeInTheDocument();
    expect(mocks.loadLatest).toHaveBeenCalledWith(["project-a"]);
  });

  it("dates older activity and says no activity is recorded today", async () => {
    mocks.loadLatest.mockResolvedValue({ "project-a": { ...event, occurred_at: "2026-11-19T10:00:00Z" } });
    renderDashboard();
    expect(await screen.findByText("No activity recorded today.")).toBeInTheDocument();
    expect(screen.getByText(/19 Nov 2026/)).toHaveAttribute("dateTime", "2026-11-19T10:00:00Z");
    expect(screen.getByText(/Kitchen measurements/)).toBeInTheDocument();
    expect(screen.queryByText("Today’s activity")).not.toBeInTheDocument();
    expect(screen.queryByText(/No work/i)).not.toBeInTheDocument();
  });

  it("uses the India calendar for an event just after midnight there", async () => {
    mocks.loadLatest.mockResolvedValue({ "project-a": { ...event, occurred_at: "2026-11-19T20:00:00Z" } });
    renderDashboard();
    expect(await screen.findByText("Today’s activity")).toBeInTheDocument();
    expect(screen.getByText(/20 Nov 2026/)).toHaveAttribute("dateTime", "2026-11-19T20:00:00Z");
    expect(screen.queryByText("No activity recorded today.")).not.toBeInTheDocument();
  });

  it("presents a comment as a comment rather than completed work", async () => {
    mocks.loadLatest.mockResolvedValue({ "project-a": { ...event, kind: "comment_added", source_type: "comments", source_id: "comment-a", task_id: null, payload: { body: "Please confirm the revised layout." } } });
    renderDashboard();
    expect(await screen.findByText("left a project comment")).toBeInTheDocument();
    expect(screen.getByText("Today’s activity")).toBeInTheDocument();
    expect(screen.queryByText(/marked.*Completed/i)).not.toBeInTheDocument();
  });

  it("labels unattributed system activity without inventing a project member", async () => {
    mocks.loadLatest.mockResolvedValue({ "project-a": { ...event, actor_id: null, author: null } });
    renderDashboard();
    expect(await screen.findByText("System", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/Kitchen measurements/)).toBeInTheDocument();
    expect(screen.queryByText("Project member", { exact: true })).not.toBeInTheDocument();
  });

  it("does not infer today's work from a task marked done when no activity exists", async () => {
    mocks.loadLatest.mockResolvedValue({ "project-a": null });
    renderDashboard();
    expect(await screen.findByText("Project changes will appear here automatically.")).toBeInTheDocument();
    expect(screen.getByText("No activity recorded today.")).toBeInTheDocument();
    expect(screen.queryByText(/Kitchen measurements/)).not.toBeInTheDocument();
    expect(screen.queryByText(/completed today/i)).not.toBeInTheDocument();
  });

  it("leaves projects accessible during an activity failure and retries without claiming an empty day", async () => {
    mocks.loadLatest.mockRejectedValueOnce(new Error("Activity unavailable"));
    renderDashboard();
    expect(await screen.findByRole("alert")).toHaveTextContent("Daily activity could not be loaded.");
    expect(screen.getByRole("link", { name: "Open daily status for Sample interior project" })).toBeInTheDocument();
    expect(screen.queryByText("No activity recorded today.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry daily activity" }));
    expect(await screen.findByText(/Kitchen measurements/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows loading while checking activity instead of a false empty-day message", async () => {
    let resolve!: (value: Record<string, ProjectActivity | null>) => void;
    mocks.loadLatest.mockImplementationOnce(() => new Promise((finish) => { resolve = finish; }));
    renderDashboard();
    expect(await screen.findByText("Loading daily activity…")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open daily status for Sample interior project" })).toBeInTheDocument();
    expect(screen.queryByText("No activity recorded today.")).not.toBeInTheDocument();
    await act(async () => { resolve({ "project-a": event }); });
    expect(await screen.findByText(/Kitchen measurements/)).toBeInTheDocument();
  });

  it("retains cached activity with an explicit warning if a later refresh fails", async () => {
    const client = renderDashboard();
    await screen.findByText(/Kitchen measurements/);
    mocks.loadLatest.mockRejectedValueOnce(new Error("Connection lost"));
    await act(async () => { await client.invalidateQueries({ queryKey: ["project-activity"] }); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Showing the last loaded activity.");
    expect(screen.getByText(/Kitchen measurements/)).toBeInTheDocument();
    expect(screen.queryByText("No activity recorded today.")).not.toBeInTheDocument();
  });

  it("retains the admin project totals alongside automatic activity previews", async () => {
    mocks.admin = true;
    renderDashboard();
    expect(await screen.findByText("Active projects")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(await screen.findByText(/Kitchen measurements/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Duplicate project" })).toBeInTheDocument();
  });
});
