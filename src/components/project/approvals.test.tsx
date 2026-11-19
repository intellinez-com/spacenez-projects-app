import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canRespondToApproval, TaskApprovalPanel } from "./approvals";
import type { Task } from "./data";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));

const task = { id: "task", project_id: "project", title: "Layout", stage: "layout_2d", content_revision: 2 } as Task;
const approval = {
  id: "approval", task_id: "task", revision: 2, state: "pending", requested_by: "partner", requested_at: "2026-11-19T10:00:00Z",
  decided_by: null, decided_at: null, feedback: null,
  snapshot: { version: 1, task: { title: "Layout", stage: "layout_2d", description: "Submitted layout" }, documents: [] },
};

function show(rows = [approval], props: { canEdit?: boolean; canApprove?: boolean; currentUserId?: string } = {}) {
  mocks.from.mockImplementation((table: string) => {
    const chain: any = {};
    for (const method of ["select", "eq"]) chain[method] = () => chain;
    chain.order = async () => ({ data: table === "task_approvals" ? rows : [], error: null });
    return chain;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <TaskApprovalPanel task={task} projectId="project" currentUserId={props.currentUserId ?? "client"} canEdit={props.canEdit ?? false} canApprove={props.canApprove ?? true} people={[]} />
  </QueryClientProvider>);
}

beforeEach(() => vi.resetAllMocks());

describe("client review boundaries", () => {
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
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
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
});
