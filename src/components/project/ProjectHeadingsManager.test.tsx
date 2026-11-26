import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectStageMutations } from "@/lib/project-stages";
import { ProjectHeadingsManager, type HeadingDialog } from "./ProjectHeadingsManager";

const stages = [{ key: "planning", label: "Planning" }, { key: "custom_kitchen", label: "Kitchen installation" }];
function show(dialog: HeadingDialog, { tasks = [], currentStage = "planning", catalog = stages, mutation: overrides = {} }: {
  tasks?: { stage: string }[]; currentStage?: string; catalog?: typeof stages; mutation?: Partial<ProjectStageMutations>;
} = {}) {
  const mutation: ProjectStageMutations = {
    mutate: vi.fn().mockResolvedValue(true), retry: vi.fn().mockResolvedValue(true), discardRejected: vi.fn(),
    busy: false, pending: null, error: null, clearError: vi.fn(), disabled: false,
    ...overrides,
  };
  const onDialogChange = vi.fn();
  render(<ProjectHeadingsManager dialog={dialog} onDialogChange={onDialogChange} mutation={mutation} stages={catalog} tasks={tasks} currentStage={currentStage} version={8} />);
  return { mutation, onDialogChange };
}

describe("project heading editor", () => {
  it("requires an explicit destination before removing a heading with work", () => {
    const dialog: HeadingDialog = { kind: "archive", key: "custom_kitchen", destination: "", version: 3 };
    const { mutation, onDialogChange } = show(dialog, { tasks: [{ stage: "custom_kitchen" }, { stage: "custom_kitchen" }] });
    const form = within(screen.getByRole("form", { name: "Remove project heading" }));
    expect(form.getByRole("button", { name: "Remove heading" })).toBeDisabled();
    expect(form.getByText(/No tasks will be deleted/)).toBeInTheDocument();
    expect(form.getByText(/Existing client review requests may need to be sent again/)).toBeInTheDocument();
    fireEvent.change(form.getByRole("combobox", { name: "Move tasks to" }), { target: { value: "planning" } });
    expect(onDialogChange).toHaveBeenCalledWith({ ...dialog, destination: "planning" });
    expect(mutation.mutate).not.toHaveBeenCalled();
  });

  it("moves current stage only to a destination explicitly selected by the admin", () => {
    const { mutation } = show({ kind: "archive", key: "planning", destination: "custom_kitchen", version: 3 });
    fireEvent.submit(screen.getByRole("form", { name: "Remove project heading" }));
    expect(mutation.mutate).toHaveBeenCalledWith({ type: "archive", key: "planning", move_to: "custom_kitchen" }, 3);
  });

  it("can remove an empty noncurrent heading without a move and prevents removing the last heading", () => {
    const { mutation } = show({ kind: "archive", key: "custom_kitchen", destination: "", version: 3 });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole("form", { name: "Remove project heading" }));
    expect(mutation.mutate).toHaveBeenCalledWith({ type: "archive", key: "custom_kitchen" }, 3);
  });

  it("keeps at least one active heading", () => {
    show({ kind: "archive", key: "planning", destination: "", version: 3 }, { catalog: [stages[0]!] });
    expect(screen.getByRole("button", { name: "Remove heading" })).toBeDisabled();
    expect(screen.getByText("At least one heading must remain.")).toBeInTheDocument();
  });

  it("freezes an unresolved draft and offers an exact retry instead of another submit", () => {
    const { mutation } = show({ kind: "add", label: "Kitchen", version: 3 }, { mutation: {
      disabled: true,
      pending: { projectId: "project", expectedVersion: 3, requestId: "request", action: { type: "add", label: "Kitchen" } },
      error: { message: "Connection lost", definite: false, saved: false, conflict: false },
    } });
    expect(screen.getByRole("textbox", { name: "Heading name" })).toBeDisabled();
    expect(within(screen.getByRole("form")).getByRole("button", { name: "Add heading" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry same change" }));
    expect(mutation.retry).toHaveBeenCalledOnce();
    expect(mutation.mutate).not.toHaveBeenCalled();
  });

  it("requires reviewing a refreshed catalog before submitting a stale draft again", () => {
    const dialog: HeadingDialog = { kind: "rename", key: "planning", label: "My renamed heading", version: 3 };
    const { onDialogChange, mutation } = show(dialog, { mutation: { error: { message: "Changed elsewhere", definite: true, saved: false, conflict: true } } });
    expect(screen.getByRole("button", { name: "Save heading name" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Use refreshed headings" }));
    expect(onDialogChange).toHaveBeenCalledWith({ ...dialog, version: 8 });
    expect(mutation.clearError).toHaveBeenCalledOnce();
  });
});
