import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectOverview, type ProjectOverviewProps } from "./ProjectOverview";
import type { Doc, Task } from "./data";

const { createSignedUrls, openDoc, from } = vi.hoisted(() => ({ createSignedUrls: vi.fn(), openDoc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, storage: { from: () => ({ createSignedUrls }) } } }));
vi.mock("./data", async (original) => ({ ...await original<typeof import("./data")>(), openDoc }));
vi.mock("./ProjectUpdates", () => ({ RecentProjectUpdates: ({ onOpenUpdates }: { onOpenUpdates: () => void }) => <button onClick={onOpenUpdates}>All updates and comments</button> }));

afterEach(() => { vi.clearAllMocks(); });

function renderOverview(overrides: Partial<ProjectOverviewProps> = {}) {
  const props: ProjectOverviewProps = {
    project: { id: "project-a", name: "Example project", current_stage: "site_survey", status: "active", start_date: null, target_date: null } as ProjectOverviewProps["project"],
    tasks: [], documents: [], onOpenTask: vi.fn(), onOpenFiles: vi.fn(), onOpenUpdates: vi.fn(), ...overrides,
  };
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ProjectOverview {...props} /></QueryClientProvider>);
  return props;
}

describe("Client project overview", () => {
  it("shows actual completion, overdue work, and missing dates without promising a schedule", () => {
    const tasks = [
      { id: "finished", project_id: "project-a", title: "Measure the site", status: "done", stage: "site_survey", due_date: null, position: 0 },
      { id: "late", project_id: "project-a", title: "Review layout", status: "review", stage: "layout_2d", start_date: "1999-12-31", due_date: "2000-01-01", position: 1 },
      { id: "undated", project_id: "project-a", title: "Choose materials", status: "not_started", stage: "interior_design", due_date: null, position: 2 },
      { id: "foreign", project_id: "other-project", title: "Private task", status: "done", stage: "handover", due_date: null, position: 0 },
    ] as Task[];
    const props = renderOverview({ tasks });
    expect(screen.getByText("1 of 3 (33%)")).toBeInTheDocument();
    expect(screen.getByLabelText("Tasks completed")).toHaveAttribute("value", "33");
    expect(screen.getByText("1 task is overdue.")).toBeInTheDocument();
    expect(screen.getAllByText("Not set")).toHaveLength(2);
    expect(screen.getByText("No upcoming due dates set")).toBeInTheDocument();
    expect(screen.getByText("Starts 31 Dec 1999")).toBeInTheDocument();
    expect(screen.queryByText("Private task")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Review layout/ }));
    expect(props.onOpenTask).toHaveBeenCalledWith(tasks[1]);
    expect(screen.queryByText(/on track/i)).not.toBeInTheDocument();
  });

  it("signs only this project's raster photo paths and uses signed opening for documents", async () => {
    const documents = [
      { id: "photo", project_id: "project-a", name: "Site photo.jpg", path: "project-a/site.jpg", created_at: "2026-11-19T10:00:00Z", size: 100 },
      { id: "svg", project_id: "project-a", name: "Layout.svg", path: "project-a/layout.svg", created_at: "2026-11-19T09:00:00Z", size: 200 },
      { id: "oversized", project_id: "project-a", name: "Large original.jpg", path: "project-a/original.jpg", created_at: "2026-11-19T09:00:00Z", size: 6 * 1024 * 1024 },
      { id: "foreign", project_id: "other-project", name: "Other.jpg", path: "other-project/site.jpg", created_at: "2026-11-19T11:00:00Z", size: 100 },
      { id: "badpath", project_id: "project-a", name: "Unrelated.jpg", path: "other-project/unrelated.jpg", created_at: "2026-11-19T11:00:00Z", size: 100 },
    ] as Doc[];
    createSignedUrls.mockResolvedValue({ data: [{ path: "project-a/site.jpg", signedUrl: "https://example.supabase.co/signed-site-photo" }], error: null });
    const props = renderOverview({ documents });
    await waitFor(() => expect(screen.getByRole("img", { name: "Site photo.jpg" })).toHaveAttribute("src", "https://example.supabase.co/signed-site-photo"));
    expect(createSignedUrls).toHaveBeenCalledWith(["project-a/site.jpg"], 300);
    expect(screen.queryByRole("img", { name: "Large original.jpg" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Large original.jpg/ })).toBeInTheDocument();
    expect(screen.queryByText("Other.jpg")).not.toBeInTheDocument();
    expect(screen.queryByText("Unrelated.jpg")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Layout.svg/ }));
    expect(openDoc).toHaveBeenCalledWith("project-a/layout.svg");
    fireEvent.click(screen.getByRole("button", { name: "All files (3)" }));
    expect(props.onOpenFiles).toHaveBeenCalledTimes(1);
  });
});
