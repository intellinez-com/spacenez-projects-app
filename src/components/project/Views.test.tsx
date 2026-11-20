import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TableView } from "./Views";
import type { Profile, Task } from "./data";

const task = {
  id: "task-a", title: "Confirm the complete furniture layout and circulation space", stage: "planning",
  status: "in_progress", priority: "high", assignee_id: "person-a", start_date: "2026-11-19", due_date: null,
} as Task;
const person = { id: "person-a", full_name: "Project coordinator with a complete name", email: "coordinator@example.test" } as Profile;

function renderWork(canEdit = false, onAdd = vi.fn().mockResolvedValue(undefined)) {
  const onOpen = vi.fn();
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  render(<TableView tasks={[task]} people={[person]} canEdit={canEdit} onOpen={onOpen} onUpdate={onUpdate} onAdd={onAdd} />);
  return { onOpen, onUpdate, onAdd };
}

describe("Responsive work items", () => {
  it("lets clients read the complete task metadata and open it without edit controls", () => {
    const { onOpen, onUpdate } = renderWork();
    const item = within(screen.getByRole("listitem"));
    expect(item.getByText(task.title)).toBeInTheDocument();
    expect(item.getByText(person.full_name!)).toBeInTheDocument();
    expect(item.getByText("In progress")).toBeInTheDocument();
    expect(item.getByText("High")).toBeInTheDocument();
    expect(item.getByText("19 Nov 2026")).toBeInTheDocument();
    expect(item.getByText("Not set")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add item" })).not.toBeInTheDocument();
    fireEvent.click(item.getByRole("button", { name: task.title }));
    expect(onOpen).toHaveBeenCalledWith(task);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("preserves editor status and date updates in the touch layout", () => {
    const { onUpdate } = renderWork(true);
    const item = within(screen.getByRole("listitem"));
    fireEvent.change(item.getByRole("combobox", { name: `Status for ${task.title}` }), { target: { value: "review" } });
    expect(onUpdate).toHaveBeenCalledWith(task.id, { status: "review" });
    fireEvent.change(item.getByLabelText(`Start date for ${task.title}`), { target: { value: "" } });
    expect(onUpdate).toHaveBeenCalledWith(task.id, { start_date: null });
    fireEvent.change(item.getByLabelText(`Due date for ${task.title}`), { target: { value: "2026-12-01" } });
    expect(onUpdate).toHaveBeenCalledWith(task.id, { due_date: "2026-12-01" });
  });

  it("adds an item with the visible submit button and clears only a saved draft", async () => {
    const { onAdd } = renderWork(true);
    const form = within(screen.getAllByRole("form", { name: "Add item to Planning & Brief" })[0]!);
    const input = form.getByRole("textbox");
    const submit = form.getByRole("button", { name: "Add item" });
    expect(submit).toBeDisabled();
    fireEvent.change(input, { target: { value: "  Confirm dimensions  " } });
    fireEvent.click(submit);
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("planning", "Confirm dimensions", 1));
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("retains an item draft when saving fails", async () => {
    renderWork(true, vi.fn().mockRejectedValue(new Error("Save failed")));
    const form = within(screen.getAllByRole("form", { name: "Add item to Planning & Brief" })[0]!);
    const input = form.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Keep this draft" } });
    fireEvent.click(form.getByRole("button", { name: "Add item" }));
    await waitFor(() => expect(form.getByRole("button", { name: "Add item" })).toBeEnabled());
    expect(input).toHaveValue("Keep this draft");
  });
});
