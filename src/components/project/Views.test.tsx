import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { TableView } from "./Views";
import type { Doc, Profile, Task } from "./data";

const task = {
  id: "task-a", title: "Confirm the complete furniture layout and circulation space", stage: "planning",
  status: "in_progress", priority: "high", assignee_id: "person-a", start_date: "2026-11-19", due_date: null,
  position: 12,
} as Task;
const otherTask = { ...task, id: "task-b", title: "Finalise the material samples", stage: "interior_design", status: "not_started", position: 30 } as Task;
const person = { id: "person-a", full_name: "Project coordinator with a complete name", email: "coordinator@example.test" } as Profile;
const doc = { id: "file-a", task_id: task.id } as Doc;

type TableCallbacks = Pick<ComponentProps<typeof TableView>, "onAdd" | "onUpdate">;

function renderWork({ canEdit = true, tasks = [task], onAdd = vi.fn<TableCallbacks["onAdd"]>().mockResolvedValue(undefined), onUpdate = vi.fn<TableCallbacks["onUpdate"]>().mockResolvedValue(undefined) }: {
  canEdit?: boolean; tasks?: Task[]; onAdd?: TableCallbacks["onAdd"]; onUpdate?: TableCallbacks["onUpdate"];
} = {}) {
  const onOpen = vi.fn();
  render(<TableView tasks={tasks} people={[person]} documents={[doc]} defaultStage="execution" canEdit={canEdit} onOpen={onOpen} onUpdate={onUpdate} onAdd={onAdd} />);
  return { onOpen, onUpdate, onAdd };
}
function taskList() { return within(screen.getByRole("list", { name: "Planning & Brief task list" })); }
function taskSheet() { return within(screen.getByRole("region", { name: "Planning & Brief task sheet" })); }
function addForm() { return within(screen.getByRole("form", { name: "Add a task" })); }

describe("Project task sheet", () => {
  it("shows only stages with work and lets clients open task comments and files without task write controls", () => {
    const { onOpen, onUpdate } = renderWork({ canEdit: false });
    const list = taskList();
    expect(list.getByText(task.title)).toBeInTheDocument();
    expect(list.getByText("In progress")).toBeInTheDocument();
    expect(list.getByText(person.full_name!)).toBeInTheDocument();
    expect(list.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Execution task sheet" })).not.toBeInTheDocument();
    fireEvent.click(list.getByRole("button", { name: task.title }));
    expect(onOpen).toHaveBeenLastCalledWith(task);
    fireEvent.click(list.getByRole("button", { name: `Comments for ${task.title}` }));
    expect(onOpen).toHaveBeenLastCalledWith(task, "comments");
    fireEvent.click(list.getByRole("button", { name: `Files for ${task.title} (1)` }));
    expect(onOpen).toHaveBeenLastCalledWith(task, "files");
    fireEvent.click(list.getByRole("button", { name: `Show more fields for ${task.title}` }));
    expect(list.getByText("19 Nov 2026")).toBeInTheDocument();
    expect(list.getByText("High")).toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("adds a task to an empty stage from the obvious top button, using a position after existing tasks", async () => {
    const { onAdd } = renderWork({ tasks: [task, otherTask] });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    const form = addForm();
    expect(form.getByRole("combobox", { name: "Stage" })).toHaveValue("execution");
    expect(form.getByRole("button", { name: "Create task" })).toBeDisabled();
    fireEvent.change(form.getByRole("textbox", { name: "Task name" }), { target: { value: "  Confirm site readiness  " } });
    fireEvent.change(form.getByRole("combobox", { name: "Stage" }), { target: { value: "site_survey" } });
    fireEvent.submit(screen.getByRole("form", { name: "Add a task" }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("site_survey", "Confirm site readiness", 31));
    await waitFor(() => expect(form.getByRole("textbox", { name: "Task name" })).toHaveValue(""));
    expect(screen.getByRole("status")).toHaveTextContent("Task added to Site Survey.");
  });

  it("preserves an unsaved add draft and its stage after failure and after closing the form", async () => {
    const { onAdd } = renderWork({ onAdd: vi.fn().mockRejectedValue(new Error("Connection lost")) });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    const form = addForm();
    fireEvent.change(form.getByRole("textbox", { name: "Task name" }), { target: { value: "Keep this draft" } });
    fireEvent.change(form.getByRole("combobox", { name: "Stage" }), { target: { value: "drawings" } });
    fireEvent.click(form.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(form.getByRole("button", { name: "Create task" })).toBeEnabled());
    expect(onAdd).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("Changes were not saved. Connection lost");
    fireEvent.click(form.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(addForm().getByRole("textbox", { name: "Task name" })).toHaveValue("Keep this draft");
    expect(addForm().getByRole("combobox", { name: "Stage" })).toHaveValue("drawings");
  });

  it("edits status, owner and dates directly in the spreadsheet row", async () => {
    const { onUpdate } = renderWork();
    const sheet = taskSheet();
    expect(sheet.getAllByRole("columnheader")).toHaveLength(6);
    for (const row of sheet.getAllByRole("row").slice(1)) expect(within(row).getAllByRole("cell")).toHaveLength(6);
    fireEvent.change(sheet.getByRole("combobox", { name: `Status for ${task.title}` }), { target: { value: "review" } });
    await waitFor(() => expect(sheet.getByRole("combobox", { name: `Status for ${task.title}` })).toBeEnabled());
    expect(onUpdate).toHaveBeenLastCalledWith(task.id, { status: "review" });
    fireEvent.change(sheet.getByRole("combobox", { name: `Owner for ${task.title}` }), { target: { value: "" } });
    await waitFor(() => expect(sheet.getByRole("combobox", { name: `Owner for ${task.title}` })).toBeEnabled());
    expect(onUpdate).toHaveBeenLastCalledWith(task.id, { assignee_id: null });
    fireEvent.change(sheet.getByLabelText(`Start date for ${task.title}`), { target: { value: "" } });
    await waitFor(() => expect(sheet.getByLabelText(`Start date for ${task.title}`)).toBeEnabled());
    expect(onUpdate).toHaveBeenLastCalledWith(task.id, { start_date: null });
    fireEvent.change(sheet.getByLabelText(`Due date for ${task.title}`), { target: { value: "2026-12-01" } });
    await waitFor(() => expect(sheet.getByLabelText(`Due date for ${task.title}`)).toBeEnabled());
    expect(onUpdate).toHaveBeenLastCalledWith(task.id, { due_date: "2026-12-01" });
  });

  it("blocks overlapping writes to one task and restores the saved status when a write fails", async () => {
    let reject: ((error: Error) => void) | undefined;
    const onUpdate = vi.fn().mockImplementation(() => new Promise<void>((_resolve, rejectWrite) => { reject = rejectWrite; }));
    renderWork({ onUpdate });
    const sheet = taskSheet();
    const status = sheet.getByRole("combobox", { name: `Status for ${task.title}` });
    fireEvent.change(status, { target: { value: "done" } });
    expect(status).toBeDisabled();
    expect(sheet.getByLabelText(`Due date for ${task.title}`)).toBeDisabled();
    fireEvent.change(sheet.getByLabelText(`Due date for ${task.title}`), { target: { value: "2026-12-01" } });
    expect(onUpdate).toHaveBeenCalledOnce();
    reject!(new Error("No access"));
    await waitFor(() => expect(status).toBeEnabled());
    expect(status).toHaveValue("in_progress");
    expect(sheet.getByRole("alert")).toHaveTextContent("Changes were not saved. No access");
  });

  it("retains a failed rename draft when filters hide and restore the row", async () => {
    const { onUpdate } = renderWork({ onUpdate: vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined) });
    fireEvent.click(taskSheet().getByRole("button", { name: `Rename ${task.title}` }));
    fireEvent.change(taskSheet().getByRole("textbox", { name: `Task name for ${task.title}` }), { target: { value: "Revised layout task" } });
    fireEvent.click(taskSheet().getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(taskSheet().getByRole("button", { name: "Save name" })).toBeEnabled());
    expect(taskSheet().getByRole("alert")).toHaveTextContent("Offline");
    fireEvent.change(screen.getByRole("textbox", { name: "Search tasks" }), { target: { value: "nothing matches" } });
    expect(screen.getByText("No tasks match your search or status filter.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(taskSheet().getByRole("textbox", { name: `Task name for ${task.title}` })).toHaveValue("Revised layout task");
    fireEvent.click(taskSheet().getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(taskSheet().queryByRole("textbox", { name: `Task name for ${task.title}` })).not.toBeInTheDocument());
    expect(onUpdate).toHaveBeenLastCalledWith(task.id, { title: "Revised layout task" });
  });

  it("filters tasks by status and search and can expand empty stages without losing available creation stages", () => {
    renderWork({ tasks: [task, otherTask] });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter tasks by status" }), { target: { value: "not_started" } });
    expect(screen.queryByRole("region", { name: "Planning & Brief task sheet" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Interior Design & Materials task sheet" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search tasks" }), { target: { value: "wrong title" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Empty stages" }));
    expect(screen.getByRole("region", { name: "Handover task sheet" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add task to Handover" }));
    expect(addForm().getByRole("combobox", { name: "Stage" })).toHaveValue("handover");
  });

  it("collapses a stage without discarding its rename draft", () => {
    renderWork();
    fireEvent.click(taskSheet().getByRole("button", { name: `Rename ${task.title}` }));
    fireEvent.change(taskSheet().getByRole("textbox", { name: `Task name for ${task.title}` }), { target: { value: "Draft name" } });
    const collapse = screen.getByRole("button", { name: "Planning & Brief 0/1 done" });
    fireEvent.click(collapse);
    expect(collapse).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(collapse);
    expect(taskSheet().getByRole("textbox", { name: `Task name for ${task.title}` })).toHaveValue("Draft name");
  });
});
