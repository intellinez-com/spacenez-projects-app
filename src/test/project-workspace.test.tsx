import type { ComponentType, ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ id: "project-a", admin: false, access: "client", finance: vi.fn(), sheet: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useParams: () => ({ id: mocks.id }) }),
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => <a href={to} {...props}>{children}</a>,
}));
vi.mock("@/lib/auth", () => ({ useMe: () => ({ data: { id: "viewer", isAdmin: mocks.admin } }) }));
vi.mock("@/components/project/data", () => ({
  useProject: () => ({ data: {
    project: { id: mocks.id, name: "Sample project", current_stage: "planning", project_type: "Office" },
    tasks: [{ id: "task-a", title: "Sample task", status: "not_started" }], documents: [],
    members: [{ user_id: "viewer", access: mocks.access }],
  }, refetch: vi.fn() }),
  useTaskMutations: () => ({ update: vi.fn(), add: vi.fn(), remove: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/project/Views", () => ({
  TableView: ({ canEdit, onOpen, tasks }: { canEdit: boolean; onOpen: (task: unknown, section?: string) => void; tasks: unknown[] }) => <div>
    <p>{canEdit ? "Editable task sheet" : "Read-only task sheet"}</p>
    <button onClick={() => onOpen(tasks[0], "comments")}>Row comments</button>
    <button onClick={() => onOpen(tasks[0], "files")}>Row files</button>
    <button onClick={() => onOpen(tasks[0])}>Open row</button>
  </div>,
  BoardView: () => <p>Alternate board</p>, TimelineView: () => <p>Alternate timeline</p>,
}));
vi.mock("@/components/project/DailyStatus", () => ({ DailyStatus: () => <p>Automatic daily progress</p> }));
vi.mock("@/components/project/ProjectOverview", () => ({ ProjectOverview: () => <p>Project summary content</p> }));
vi.mock("@/components/project/ProjectDetails", () => ({ ProjectDetails: () => null }));
vi.mock("@/components/project/ProjectUpdates", () => ({ ProjectUpdates: () => null }));
vi.mock("@/components/project/approvals", () => ({ ApprovalOverview: () => null }));
vi.mock("@/components/project/TaskSheet", () => ({ TaskSheet: (props: unknown) => { mocks.sheet(props); return null; } }));
vi.mock("@/components/project/ProjectPayments", () => ({ ProjectPayments: () => { mocks.finance(); return <p>Admin finance content</p>; } }));

import { Route } from "@/routes/_authenticated/projects.$id";
const ProjectPage = Route.options.component as ComponentType;
const clients: QueryClient[] = [];
function renderProject() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  return render(<QueryClientProvider client={client}><ProjectPage /></QueryClientProvider>);
}
function openMore() { fireEvent.keyDown(screen.getByRole("button", { name: "More project options" }), { key: "Enter" }); }

beforeEach(() => { vi.clearAllMocks(); mocks.id = "project-a"; mocks.admin = false; mocks.access = "client"; });
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

describe("Simple project workspace", () => {
  it.each(["admin", "partner"])("opens %s users directly on the editable task sheet", (role) => {
    mocks.admin = role === "admin"; mocks.access = role === "partner" ? "partner" : "client";
    renderProject();
    expect(screen.getByText("Editable task sheet")).toBeInTheDocument();
    const nav = within(screen.getByRole("navigation", { name: "Project sections" }));
    expect(nav.getByRole("button", { name: "Tasks" })).toHaveAttribute("aria-current", "page");
    expect(nav.getAllByRole("button")).toHaveLength(5);
    expect(screen.queryByText("Automatic daily progress")).not.toBeInTheDocument();
    expect(mocks.finance).not.toHaveBeenCalled();
  });

  it("opens clients on automatic progress with a read-only task sheet and no finance controls", () => {
    renderProject();
    expect(screen.getByText("Automatic daily progress")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
    expect(screen.getByText("Read-only task sheet")).toBeInTheDocument();
    openMore();
    expect(screen.queryByRole("menuitem", { name: "Payments" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Team & access" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Board view" })).not.toBeInTheDocument();
    expect(mocks.finance).not.toHaveBeenCalled();
  });

  it("keeps partner alternate views available without admin finance or team settings", () => {
    mocks.access = "partner"; renderProject(); openMore();
    expect(screen.getByRole("menuitem", { name: "Board view" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Timeline view" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Payments" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Team & access" })).not.toBeInTheDocument();
  });

  it("unmounts finance immediately if admin access is withdrawn", () => {
    mocks.admin = true; const view = renderProject(); openMore();
    fireEvent.click(screen.getByRole("menuitem", { name: "Payments" }));
    expect(screen.getByText("Admin finance content")).toBeInTheDocument();
    mocks.admin = false;
    view.rerender(<QueryClientProvider client={clients[0]!}><ProjectPage /></QueryClientProvider>);
    expect(screen.queryByText("Admin finance content")).not.toBeInTheDocument();
    expect(screen.getByText("Automatic daily progress")).toBeInTheDocument();
    expect(mocks.finance).toHaveBeenCalledTimes(1);
  });

  it("resets a secondary destination when opening a different project", () => {
    mocks.admin = true; const view = renderProject(); openMore();
    fireEvent.click(screen.getByRole("menuitem", { name: "Project summary" }));
    expect(screen.getByText("Project summary content")).toBeInTheDocument();
    mocks.id = "project-b";
    view.rerender(<QueryClientProvider client={clients[0]!}><ProjectPage /></QueryClientProvider>);
    expect(screen.getByText("Editable task sheet")).toBeInTheDocument();
    expect(screen.queryByText("Project summary content")).not.toBeInTheDocument();
  });

  it("routes row shortcuts to their section and clears the target for an ordinary open", () => {
    mocks.admin = true; renderProject();
    fireEvent.click(screen.getByRole("button", { name: "Row comments" }));
    expect(mocks.sheet.mock.lastCall?.[0]).toMatchObject({ initialSection: "comments", task: { id: "task-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Row files" }));
    expect(mocks.sheet.mock.lastCall?.[0]).toMatchObject({ initialSection: "files" });
    fireEvent.click(screen.getByRole("button", { name: "Open row" }));
    expect(mocks.sheet.mock.lastCall?.[0].initialSection).toBeUndefined();
  });
});
