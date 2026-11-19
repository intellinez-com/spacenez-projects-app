import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectDetails } from "./ProjectDetails";
import type { Database } from "@/integrations/supabase/types";

const { update, eq, is, select, single } = vi.hoisted(() => ({ update: vi.fn(), eq: vi.fn(), is: vi.fn(), select: vi.fn(), single: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ update }) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
type Project = Database["public"]["Tables"]["projects"]["Row"];
const project = { id: "project-a", name: "Example project", client_name: null, client_brand: null, client_email: null, location: "Site A", project_type: "Other", description: null, start_date: null, target_date: null, meeting_url: null } as Project;

beforeEach(() => {
  vi.clearAllMocks();
  const chain = { eq, is, select, single };
  update.mockReturnValue(chain); eq.mockReturnValue(chain); is.mockReturnValue(chain); select.mockReturnValue(chain);
  single.mockResolvedValue({ data: { ...project, name: "Updated project" }, error: null });
});

describe("Project details refresh and saving", () => {
  it("refreshes a client's read-only details when server values change", async () => {
    const { rerender } = render(<ProjectDetails project={project} canEdit={false} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Site / location")).toBeDisabled();
    rerender(<ProjectDetails project={{ ...project, location: "Site B" }} canEdit={false} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("Site / location")).toHaveValue("Site B"));
    expect(screen.queryByRole("button", { name: "Save details" })).not.toBeInTheDocument();
  });

  it("preserves a draft and blocks saving after another editor changes the details", () => {
    const { rerender } = render(<ProjectDetails project={project} canEdit onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "My draft" } });
    rerender(<ProjectDetails project={{ ...project, location: "Site B" }} canEdit onChange={vi.fn()} />);
    expect(screen.getByLabelText("Project name")).toHaveValue("My draft");
    expect(screen.getByRole("button", { name: "Save details" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Load latest details" }));
    expect(screen.getByLabelText("Site / location")).toHaveValue("Site B");
    expect(screen.getByLabelText("Project name")).toHaveValue("Example project");
  });

  it("writes only changed fields and compares their original values", async () => {
    const onChange = vi.fn();
    render(<ProjectDetails project={project} canEdit onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Updated project" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(update).toHaveBeenCalledWith({ name: "Updated project" });
    expect(eq).toHaveBeenCalledWith("id", "project-a");
    expect(eq).toHaveBeenCalledWith("name", "Example project");
  });
});
