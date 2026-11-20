import type { ComponentType, ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyUpdate } from "@/lib/daily-updates";

const mocks = vi.hoisted(() => ({ from: vi.fn(), loadLatest: vi.fn(), admin: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/lib/auth", () => ({ useMe: () => ({ data: { id: "viewer", isAdmin: mocks.admin } }) }));
vi.mock("@/lib/daily-updates", () => ({ loadLatestDailyUpdates: mocks.loadLatest, projectDay: () => "2026-11-20" }));
vi.mock("@/components/project/ProjectImportDialog", () => ({ ProjectImportDialog: () => null }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ to, params, children, ...props }: { to: string; params?: Record<string, string>; children?: ReactNode }) => <a href={to.replace("$id", params?.["id"] ?? "")} {...props}>{children}</a>,
}));

import { Route } from "@/routes/_authenticated/dashboard";
const Dashboard = Route.options.component as ComponentType;
const clients: QueryClient[] = [];
const report: DailyUpdate = {
  id: "report-a", project_id: "project-a", report_date: "2026-11-20",
  work_done: "Completed the kitchen measurements and shared the revised drawing.",
  next_steps: "Review the revised drawing.", blockers: "Waiting for tile samples.",
  created_by: "designer", created_at: "2026-11-20T10:00:00Z", author: { full_name: "Designer", email: "designer@example.test" },
};

beforeEach(() => {
  vi.resetAllMocks(); mocks.admin = false;
  mocks.from.mockImplementation((table: string) => {
    if (table === "projects") return { select: () => ({ order: async () => ({ data: [{
      id: "project-a", name: "Sample interior project", project_type: "Commercial", client_name: "Sample Client", location: "Sample site",
      target_date: null, current_stage: "layout_2d", status: "active", created_at: "2026-11-01T00:00:00Z",
    }], error: null }) }) };
    if (table === "tasks") return { select: async () => ({ data: [{ id: "task-a", project_id: "project-a", status: "done", due_date: null, updated_at: "2026-11-20T09:00:00Z" }], error: null }) };
    throw new Error(`Unexpected table ${table}`);
  });
  mocks.loadLatest.mockResolvedValue({ "project-a": report });
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><Dashboard /></QueryClientProvider>);
  return client;
}

describe("Daily status on the client dashboard", () => {
  it("puts the real daily report on the project entry and keeps the admin totals out of the client view", async () => {
    renderDashboard();
    expect(screen.getByRole("heading", { name: "Your project updates" })).toBeInTheDocument();
    expect(await screen.findByText(report.work_done)).toBeInTheDocument();
    expect(screen.getByText("Today’s update · 20 Nov 2026")).toBeInTheDocument();
    expect(screen.getByText("Waiting for tile samples.", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open daily status for Sample interior project" })).toHaveAttribute("href", "/projects/project-a");
    expect(screen.getByText("Open daily status →")).toBeInTheDocument();
    expect(screen.queryByText("Active projects")).not.toBeInTheDocument();
    expect(screen.queryByText("Open tasks")).not.toBeInTheDocument();
    expect(mocks.loadLatest).toHaveBeenCalledWith(["project-a"]);
  });

  it("keeps an older report dated and says today's report is missing", async () => {
    mocks.loadLatest.mockResolvedValue({ "project-a": { ...report, report_date: "2026-11-19" } });
    renderDashboard();
    expect(await screen.findByText("No daily update posted today.")).toBeInTheDocument();
    expect(screen.getByText("19 Nov 2026")).toHaveAttribute("dateTime", "2026-11-19");
    expect(screen.getByText(report.work_done)).toBeInTheDocument();
    expect(screen.queryByText(/Today’s update/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No work/i)).not.toBeInTheDocument();
  });

  it("does not infer daily work from a task marked done when no report exists", async () => {
    mocks.loadLatest.mockResolvedValue({ "project-a": null });
    renderDashboard();
    expect(await screen.findByText("The team has not shared a daily report yet.")).toBeInTheDocument();
    expect(screen.getByText("No daily update posted today.")).toBeInTheDocument();
    expect(screen.queryByText(report.work_done)).not.toBeInTheDocument();
    expect(screen.queryByText(/completed today/i)).not.toBeInTheDocument();
  });

  it("leaves projects accessible during a report failure and retries without claiming an empty day", async () => {
    mocks.loadLatest.mockRejectedValueOnce(new Error("Daily reports unavailable"));
    renderDashboard();
    expect(await screen.findByRole("alert")).toHaveTextContent("Daily status could not be loaded.");
    expect(screen.getByRole("link", { name: "Open daily status for Sample interior project" })).toBeInTheDocument();
    expect(screen.queryByText("No daily update posted today.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry daily status" }));
    expect(await screen.findByText(report.work_done)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows loading while checking reports instead of a false missing-report message", async () => {
    let resolve!: (value: Record<string, DailyUpdate | null>) => void;
    mocks.loadLatest.mockImplementationOnce(() => new Promise((finish) => { resolve = finish; }));
    renderDashboard();
    expect(await screen.findByText("Loading daily status…")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open daily status for Sample interior project" })).toBeInTheDocument();
    expect(screen.queryByText("No daily update posted today.")).not.toBeInTheDocument();
    await act(async () => { resolve({ "project-a": report }); });
    expect(await screen.findByText(report.work_done)).toBeInTheDocument();
  });

  it("retains a cached report with an explicit warning if a later refresh fails", async () => {
    const client = renderDashboard();
    await screen.findByText(report.work_done);
    mocks.loadLatest.mockRejectedValueOnce(new Error("Connection lost"));
    await act(async () => { await client.invalidateQueries({ queryKey: ["daily-updates"] }); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Showing the last loaded reports.");
    expect(screen.getByText(report.work_done)).toBeInTheDocument();
    expect(screen.queryByText("No daily update posted today.")).not.toBeInTheDocument();
  });

  it("retains the admin project totals alongside daily report previews", async () => {
    mocks.admin = true;
    renderDashboard();
    expect(await screen.findByText("Active projects")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(await screen.findByText(report.work_done)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument());
  });
});
