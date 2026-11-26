import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalOverview, canRespondToApproval, TaskApprovalPanel } from "./approvals";
import type { Task } from "./data";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));

const task = { id: "task", project_id: "project", title: "Layout", stage: "layout_2d", content_revision: 2 } as Task;
const approval = {
  id: "approval", task_id: "task", revision: 2, state: "pending", requested_by: "partner", requested_at: "2026-11-19T10:00:00Z",
  decided_by: null, decided_at: null, feedback: null,
  snapshot: { version: 1, task: { title: "Layout", stage: "layout_2d", description: "Submitted layout" }, documents: [] },
};

function mockApprovalRows(readRows: () => typeof approval[]) {
  mocks.from.mockImplementation((table: string) => {
    const chain: any = {};
    for (const method of ["select", "eq"]) chain[method] = () => chain;
    chain.order = async () => ({ data: table === "task_approvals" ? readRows() : [], error: null });
    return chain;
  });
}

function show(rows = [approval], props: { canEdit?: boolean; canApprove?: boolean; currentUserId?: string } = {}) {
  mockApprovalRows(() => rows);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <TaskApprovalPanel task={task} projectId="project" currentUserId={props.currentUserId ?? "client"} canEdit={props.canEdit ?? false} canApprove={props.canApprove ?? true} people={[]} />
  </QueryClientProvider>);
}

beforeEach(() => vi.resetAllMocks());

describe("client review boundaries", () => {
  it("keeps the heading name captured in the submitted approval snapshot", async () => {
    const capturedTask = { ...approval.snapshot.task, stage_label: "Original furniture planning" };
    show([{ ...approval, snapshot: { ...approval.snapshot, task: capturedTask } }]);
    expect(await screen.findByText("Original furniture planning")).toBeVisible();
  });
  it("allows only a different client to respond to the pending current revision", () => {
    expect(canRespondToApproval(approval, 2, "client", true)).toBe(true);
    expect(canRespondToApproval(approval, 3, "client", true)).toBe(false);
    expect(canRespondToApproval(approval, 2, "partner", true)).toBe(false);
    expect(canRespondToApproval(approval, 2, "client", false)).toBe(false);
    expect(canRespondToApproval({ ...approval, state: "approved" }, 2, "client", true)).toBe(false);
  });

  it("shows earlier submissions without offering a decision on them", async () => {
    show([{ ...approval, revision: 1 }]);
    expect(await screen.findByText("Task content changed. A new client review is needed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByText(/Earlier task content/)).toBeInTheDocument();
  });

  it("preserves the pending review and displays server errors after a failed decision", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "This submission was changed by another editor" } });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("changed by another editor");
    expect(mocks.rpc).toHaveBeenCalledWith("respond_task_approval", { p_approval_id: "approval", p_decision: "approved", p_feedback: null });
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled());
    expect(screen.getAllByText("Awaiting client review").length).toBeGreaterThan(0);
  });

  it("requires feedback before requesting changes", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Request changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Describe the changes needed");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires a content revision before resubmitting a rejected review", async () => {
    show([{ ...approval, state: "changes_requested" }], { canEdit: true, canApprove: false });
    expect(await screen.findByRole("button", { name: "Request client review" })).toBeDisabled();
    expect(screen.getByText(/Update the submitted task content or files/)).toBeInTheDocument();
  });

  it.each(["request", "approved"] as const)("refreshes an already-open project overview after %s", async (action) => {
    let rows = action === "request" ? [] : [approval];
    mockApprovalRows(() => rows);
    mocks.rpc.mockImplementation(async () => {
      rows = [{ ...approval, state: action === "request" ? "pending" : "approved" }];
      return { data: rows[0], error: null };
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}>
      <ApprovalOverview projectId="project" tasks={[task]} onOpen={vi.fn()} />
      <TaskApprovalPanel task={task} projectId="project" currentUserId={action === "request" ? "partner" : "client"} canEdit={action === "request"} canApprove={action !== "request"} people={[]} />
    </QueryClientProvider>);
    const overview = (await screen.findByRole("heading", { name: "Client reviews" })).closest("section");
    if (!overview) throw new Error("Expected the client-review overview section");
    fireEvent.click(await screen.findByRole("button", { name: action === "request" ? "Request client review" : "Approve" }));
    await waitFor(() => expect(within(overview).getByText(action === "request" ? "Awaiting client review" : "Approved")).toBeInTheDocument());
    expect(mocks.rpc).toHaveBeenCalledOnce();
    client.clear();
  });

  it("refreshes a rejected stale review without losing feedback or resubmitting automatically", async () => {
    let rows = [approval];
    mockApprovalRows(() => rows);
    const latestTask = { ...task, content_revision: 3 };
    const loadProject = vi.fn().mockResolvedValue({ task: latestTask });
    mocks.rpc.mockImplementation(async () => {
      rows = [{ ...approval, id: "latest-approval", revision: 3, snapshot: { ...approval.snapshot, task: { ...approval.snapshot.task, description: "Latest submitted layout" } } }, approval];
      return { data: null, error: { message: "The task changed; review its current revision" } };
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["project", "project"], { task });
    function CurrentTaskPanel() {
      const currentProject = useQuery<{ task: Task }>({ queryKey: ["project", "project"], queryFn: loadProject, staleTime: Infinity });
      return <TaskApprovalPanel task={currentProject.data?.task ?? task} projectId="project" currentUserId="client" canEdit={false} canApprove people={[]} />;
    }
    render(<QueryClientProvider client={client}><CurrentTaskPanel /></QueryClientProvider>);
    fireEvent.change(await screen.findByLabelText("Review feedback"), { target: { value: "Keep this feedback draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("review its current revision");
    expect(await screen.findByText("Latest submitted layout")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Request changes" })).toBeEnabled());
    expect(screen.getByLabelText("Review feedback")).toHaveValue("Keep this feedback draft");
    expect(loadProject).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("respond_task_approval", { p_approval_id: "approval", p_decision: "changes_requested", p_feedback: "Keep this feedback draft" });
    client.clear();
  });
});
