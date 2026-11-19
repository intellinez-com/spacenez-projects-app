import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSheet } from "./TaskSheet";
import type { Task } from "./data";

const mocks = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn(), insert: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, auth: { getUser: mocks.getUser } } }));
vi.mock("./approvals", () => ({ TaskApprovalPanel: () => null }));

const task = {
  id: "task", project_id: "project", title: "Original title", description: "Original description", status: "review", stage: "layout_2d",
  priority: "medium", content_revision: 1, assignee_id: null, start_date: null, due_date: null,
} as Task;

function show(overrides: { onUpdate?: (id: string, patch: Partial<Task>) => Promise<void>; onDelete?: (id: string) => Promise<void>; onClose?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <TaskSheet task={task} projectId="project" currentUserId="client" canEdit canApprove={false} people={[]} docs={[]} onClose={overrides.onClose ?? vi.fn()} onUpdate={overrides.onUpdate ?? vi.fn().mockResolvedValue(undefined)} onDelete={overrides.onDelete ?? vi.fn().mockResolvedValue(undefined)} />
  </QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.from.mockImplementation(() => {
    const chain: any = {};
    for (const method of ["select", "eq"]) chain[method] = () => chain;
    chain.order = async () => ({ data: [], error: null });
    chain.insert = mocks.insert;
    return chain;
  });
});

describe("task sheet failures", () => {
  it("keeps the task open when deletion fails", async () => {
    const onClose = vi.fn();
    show({ onDelete: vi.fn().mockRejectedValue(new Error("Delete denied")), onClose });
    fireEvent.click(screen.getByRole("button", { name: "Delete task" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Delete denied");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete task" })).toBeEnabled();
  });

  it("restores an unsaved title after the server rejects an edit", async () => {
    show({ onUpdate: vi.fn().mockRejectedValue(new Error("Save denied")) });
    const input = screen.getByDisplayValue("Original title");
    fireEvent.change(input, { target: { value: "Unsaved title" } });
    fireEvent.blur(input);
    expect(await screen.findByRole("alert")).toHaveTextContent("Save denied");
    await waitFor(() => expect(input).toHaveValue("Original title"));
  });

  it("retains a comment draft and reports an expired session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    show();
    const input = screen.getByPlaceholderText("Write a comment…");
    fireEvent.change(input, { target: { value: "Please review" } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("session has expired");
    expect(input).toHaveValue("Please review");
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
