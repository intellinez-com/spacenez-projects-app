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
    expect(screen.getByText("Site A").tagName).toBe("DD");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    rerender(<ProjectDetails project={{ ...project, location: "Site B" }} canEdit={false} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Site B").tagName).toBe("DD"));
    expect(screen.queryByRole("button", { name: "Save details" })).not.toBeInTheDocument();
  });

  it("shows complete client values and only makes a validated Calendly URL clickable", () => {
    const name = "A long project name that remains readable in the client details view";
    const location = "A full site address with a building name, floor and delivery instructions";
    const email = "a.long.client.contact.address@example.test";
    const meetingUrl = "https://calendly.com/spacenez/project-review";
    const details = { ...project, name, location, client_email: email, description: "First note\nSecond note", meeting_url: meetingUrl };
    const { rerender } = render(<ProjectDetails project={details} canEdit={false} onChange={vi.fn()} />);
    expect(screen.getByText(name).tagName).toBe("DD");
    expect(screen.getByText(location).tagName).toBe("DD");
    expect(screen.getByText(email).tagName).toBe("DD");
    expect(screen.getByText("First note Second note").tagName).toBe("DD");
    expect(screen.getByRole("link", { name: meetingUrl })).toHaveAttribute("href", meetingUrl);
    const unsafeUrl = "https://calendly.com.evil.test/book";
    rerender(<ProjectDetails project={{ ...details, meeting_url: unsafeUrl }} canEdit={false} onChange={vi.fn()} />);
    expect(screen.getByText(unsafeUrl).tagName).toBe("DD");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
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
