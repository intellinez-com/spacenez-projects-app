import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectUpdates, loadProjectUpdates } from "./ProjectUpdates";

const { from, getUser, insert, range, eq, order } = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn(), insert: vi.fn(), range: vi.fn(), eq: vi.fn(), order: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, auth: { getUser } } }));

function setup() {
  const query = { select: vi.fn().mockReturnThis(), eq, order, range, insert };
  eq.mockReturnValue(query); order.mockReturnValue(query); from.mockReturnValue(query);
  range.mockResolvedValue({ data: [], error: null });
  getUser.mockResolvedValue({ data: { user: { id: "current-user" } }, error: null });
  insert.mockResolvedValue({ error: null });
  return query;
}
function renderUpdates(canEdit = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ProjectUpdates projectId="project-a" canEdit={canEdit} /></QueryClientProvider>);
  return client;
}
afterEach(() => { vi.clearAllMocks(); });

describe("Project updates", () => {
  it("scopes author and task comment history to the project and pages 50 at a time", async () => {
    const query = setup();
    await loadProjectUpdates("project-a", 50, 50);
    expect(from).toHaveBeenCalledWith("comments");
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining("author:profiles"));
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining("task:tasks!comments_task_project_fkey(title)"));
    expect(eq).toHaveBeenCalledWith("project_id", "project-a");
    expect(range).toHaveBeenCalledWith(50, 99);
  });

  it("preserves a failed comment draft then posts once with the authenticated author", async () => {
    setup();
    insert.mockResolvedValueOnce({ error: { message: "Connection interrupted" } });
    const client = renderUpdates();
    const invalidation = vi.spyOn(client, "invalidateQueries");
    await screen.findByText("No updates or comments yet.");
    fireEvent.change(screen.getByLabelText("Leave a comment for the team"), { target: { value: "Please confirm the layout" } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
    expect(screen.getByLabelText("Leave a comment for the team")).toHaveValue("Please confirm the layout");
    let finish!: (value: unknown) => void;
    insert.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const form = screen.getByRole("button", { name: "Post comment" }).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(insert).toHaveBeenCalledTimes(2));
    expect(insert).toHaveBeenLastCalledWith({ project_id: "project-a", task_id: null, user_id: "current-user", body: "Please confirm the layout" });
    finish({ error: null });
    await waitFor(() => expect(screen.getByLabelText("Leave a comment for the team")).toHaveValue(""));
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["project-updates", "project-a"] });
  });

  it("requires a current user and shows feed errors with retry", async () => {
    setup();
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    range.mockResolvedValueOnce({ data: null, error: { message: "Unavailable" } });
    renderUpdates(true);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load project updates");
    fireEvent.click(screen.getByRole("button", { name: "Retry updates" }));
    await screen.findByText("No updates or comments yet.");
    fireEvent.change(screen.getByLabelText("Share a project update"), { target: { value: "Site measurements completed" } });
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("session has expired");
    expect(insert).not.toHaveBeenCalled();
  });
});
