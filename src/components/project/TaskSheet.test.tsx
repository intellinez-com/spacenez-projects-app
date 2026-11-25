import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSheet } from "./TaskSheet";
import type { Task } from "./data";

const mocks = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn(), insert: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, auth: { getUser: mocks.getUser } } }));
vi.mock("./approvals", () => ({ TaskApprovalPanel: () => null }));

const task = {
  id: "task", project_id: "project", title: "Original title", description: "Original description", status: "review", stage: "layout_2d",
  priority: "medium", content_revision: 1, assignee_id: null, start_date: null, due_date: null,
} as Task;

function show(overrides: { task?: Task; canEdit?: boolean; initialSection?: "comments" | "files"; onUpdate?: (id: string, patch: Partial<Task>) => Promise<void>; onDelete?: (id: string) => Promise<void>; onClose?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <TaskSheet task={overrides.task ?? task} projectId="project" currentUserId="client" canEdit={overrides.canEdit ?? true} canApprove={false} people={[]} docs={[]} initialSection={overrides.initialSection} onClose={overrides.onClose ?? vi.fn()} onUpdate={overrides.onUpdate ?? vi.fn().mockResolvedValue(undefined)} onDelete={overrides.onDelete ?? vi.fn().mockResolvedValue(undefined)} />
  </QueryClientProvider>);
}

const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
const scrollIntoView = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
  mocks.from.mockImplementation(() => {
    const chain: any = {};
    for (const method of ["select", "eq"]) chain[method] = () => chain;
    chain.order = async () => ({ data: [], error: null });
    chain.insert = mocks.insert;
    return chain;
  });
});

afterEach(() => {
  if (originalScrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

describe("task row shortcuts", () => {
  it("does not jump to a section or focus the composer on an ordinary task open", async () => {
    show();
    await waitFor(() => expect(screen.queryByText("Loading comments…")).not.toBeInTheDocument());
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Add a comment or note" })).not.toHaveFocus();
  });

  it("takes a client directly to the comment composer from a row action", async () => {
    show({ initialSection: "comments", canEdit: false });
    const composer = screen.getByRole("textbox", { name: "Add a comment or note" });
    await waitFor(() => expect(composer).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(screen.queryByLabelText("Attach task files")).not.toBeInTheDocument();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("takes an editor directly to files without opening the file picker", async () => {
    show({ initialSection: "files" });
    const heading = screen.getByRole("heading", { name: "Files" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(screen.getByText("Attach files")).toBeInTheDocument();
    expect(screen.getByLabelText("Attach task files")).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Add a comment or note" })).not.toHaveFocus();
  });

  it("follows a changed section target without discarding the task's comment draft", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sheet = (initialSection: "comments" | "files") => <QueryClientProvider client={client}>
      <TaskSheet task={task} projectId="project" currentUserId="client" canEdit={true} canApprove={false} people={[]} docs={[]} initialSection={initialSection} onClose={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} />
    </QueryClientProvider>;
    const view = render(sheet("comments"));
    const composer = screen.getByRole("textbox", { name: "Add a comment or note" });
    await waitFor(() => expect(composer).toHaveFocus());
    fireEvent.change(composer, { target: { value: "Draft note from the task row" } });
    view.rerender(sheet("files"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Files" })).toHaveFocus());
    expect(composer).toHaveValue("Draft note from the task row");
  });
});

describe("task sheet failures", () => {
  it("exposes the full read-only task content to clients without edit controls", () => {
    const title = "Detailed client layout review with materials and installation notes ".repeat(4).trim();
    const description = "Review the full design description and the detailed acceptance criteria before responding. ".repeat(6).trim();
    show({ task: { ...task, title, description, stage: "interior_design" }, canEdit: false });
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText(description)).toBeInTheDocument();
    expect(screen.getByText("Interior Design & Materials")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Task title" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete task" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Write a comment…")).toBeEnabled();
  });

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
