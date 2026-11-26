import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DuplicateProjectDialog } from "./DuplicateProjectDialog";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, params, children, ...props }: { to: string; params?: { id: string }; children?: ReactNode }) => <a href={to.replace("$id", params?.id ?? "")} {...props}>{children}</a>,
}));

const source = { id: "10000000-0000-4000-8000-000000000001", name: "Old client cafe", project_type: "Restaurant / Café" };
const actorId = "20000000-0000-4000-8000-000000000001";
const result = { project_id: "30000000-0000-4000-8000-000000000001", created: true, task_count: 12, approval_plan_count: 3, stage_count: 5 };
const clients: QueryClient[] = [];
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  const onOpenChange = vi.fn(), onCreated = vi.fn();
  const view = render(<QueryClientProvider client={client}><DuplicateProjectDialog source={source} actorId={actorId} open onOpenChange={onOpenChange} onCreated={onCreated} /></QueryClientProvider>);
  return { ...view, onOpenChange, onCreated };
}
beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear(); mocks.rpc.mockResolvedValue({ data: result, error: null }); });
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

describe("duplicate project workflow", () => {
  it("uses a fresh name and client details, then opens the new project", async () => {
    const { onCreated } = show();
    expect(screen.getByLabelText("New project name")).toHaveValue("");
    expect(screen.getByLabelText("Client name")).toHaveValue("");
    expect(screen.getByLabelText("Client email")).toHaveValue("");
    expect(screen.getByLabelText("Project type")).toHaveValue("Restaurant / Café");
    fireEvent.change(screen.getByLabelText("New project name"), { target: { value: "New restaurant" } });
    fireEvent.click(screen.getByRole("button", { name: "Create copy" }));
    expect(await screen.findByText("Project duplicated.")).toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledWith("duplicate_project", expect.objectContaining({
      p_source_project_id: source.id, p_request_id: expect.any(String), p_project: expect.objectContaining({ name: "New restaurant", client_name: "", client_email: "", location: "" }),
    }));
    expect(screen.getByRole("link", { name: "Open project" })).toHaveAttribute("href", `/projects/${result.project_id}`);
    expect(onCreated).toHaveBeenCalledWith(result);
  });

  it("keeps the exact request after a lost response and retrieves the existing copy on retry", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("Connection lost"));
    show();
    fireEvent.change(screen.getByLabelText("New project name"), { target: { value: "New restaurant" } });
    fireEvent.click(screen.getByRole("button", { name: "Create copy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
    const first = mocks.rpc.mock.calls[0]?.[1];
    expect(screen.getByLabelText("New project name")).toBeDisabled();
    cleanup();
    mocks.rpc.mockResolvedValueOnce({ data: { ...result, created: false }, error: null });
    show();
    expect(screen.getByLabelText("New project name")).toHaveValue("New restaurant");
    expect(screen.getByLabelText("New project name")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry duplication" }));
    expect(await screen.findByText("This request already completed. The existing copy is ready.")).toBeInTheDocument();
    expect(mocks.rpc.mock.calls[1]?.[1]).toEqual(first);
    expect(sessionStorage.length).toBe(0);
  });

  it("blocks repeated submits while the first request is pending", async () => {
    let complete!: (value: { data: typeof result; error: null }) => void;
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const { onOpenChange } = show();
    fireEvent.change(screen.getByLabelText("New project name"), { target: { value: "New restaurant" } });
    const form = screen.getByRole("form", { name: "Duplicate project details" });
    fireEvent.submit(form); fireEvent.submit(form);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Duplicating..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => complete({ data: result, error: null }));
    await waitFor(() => expect(screen.getByText("Project duplicated.")).toBeInTheDocument());
  });

  it("resets a completed dialog when closed so reopening starts fresh", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
    const onOpenChange = vi.fn();
    const view = render(<QueryClientProvider client={client}><DuplicateProjectDialog source={source} actorId={actorId} open onOpenChange={onOpenChange} /></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText("New project name"), { target: { value: "First copy" } });
    fireEvent.click(screen.getByRole("button", { name: "Create copy" }));
    expect(await screen.findByText("Project duplicated.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    view.rerender(<QueryClientProvider client={client}><DuplicateProjectDialog source={source} actorId={actorId} open onOpenChange={onOpenChange} /></QueryClientProvider>);
    expect(screen.getByLabelText("New project name")).toHaveValue("");
  });
});
