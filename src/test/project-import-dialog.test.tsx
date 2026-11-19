import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectImportDialog } from "@/components/project/ProjectImportDialog";
import { projectImportFixture } from "./project-import-fixture";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children, params, onClick }: { children: React.ReactNode; params: { id: string }; onClick?: () => void }) => <a href={`/projects/${params.id}`} onClick={onClick}>{children}</a> }));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("Project import dialog", () => {
  it("blocks duplicate submits and opens the existing project returned by an idempotent retry", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    let complete!: (value: unknown) => void;
    rpc.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    render(<QueryClientProvider client={new QueryClient()}><ProjectImportDialog /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Import project plan" }));
    const file = new File([JSON.stringify(projectImportFixture())], "plan.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve(JSON.stringify(projectImportFixture())) });
    fireEvent.change(screen.getByLabelText("Prepared JSON file"), { target: { files: [file] } });
    await screen.findByLabelText("Project name");
    expect(screen.getByText(/“same day” has no calendar date/)).toBeInTheDocument();
    const form = screen.getByRole("button", { name: /^Import project$/ }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("import_project_plan", expect.objectContaining({ p_source_sha256: "a".repeat(64) }));
    complete({ data: { project_id: "00000000-0000-4000-8000-000000000001", created: false, task_count: 1, approval_plan_count: 1, client_linked: false }, error: null });
    expect(await screen.findByText(/already imported/)).toBeInTheDocument();
    expect(screen.getByText(/Client access is pending/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open project" })).toHaveAttribute("href", "/projects/00000000-0000-4000-8000-000000000001");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("requires explicit destination confirmation after migration", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://newbackend.supabase.co");
    render(<QueryClientProvider client={new QueryClient()}><ProjectImportDialog /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Import project plan" }));
    const file = new File(["{}"], "plan.json");
    Object.defineProperty(file, "text", { value: () => Promise.resolve(JSON.stringify(projectImportFixture())) });
    fireEvent.change(screen.getByLabelText("Prepared JSON file"), { target: { files: [file] } });
    const submit = await screen.findByRole("button", { name: /^Import project$/ });
    expect(submit).toBeDisabled();
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /intended destination/ }));
    await waitFor(() => expect(submit).toBeEnabled());
  });
});
