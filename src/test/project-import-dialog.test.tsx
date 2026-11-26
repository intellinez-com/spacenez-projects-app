import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectImportDialog } from "@/components/project/ProjectImportDialog";
import { parseProjectImport, type ProjectImportPlan } from "@/lib/project-import";
import { projectImportFixture } from "./project-import-fixture";

const { rpc, parseFile, createTemplate } = vi.hoisted(() => ({
  rpc: vi.fn(),
  parseFile: vi.fn(),
  createTemplate: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/lib/project-plan-file", () => ({
  PROJECT_PLAN_FILE_MAX_BYTES: 5 * 1024 * 1024,
  PROJECT_PLAN_FILE_ACCEPT: ".xlsx,.csv",
  parseProjectPlanFile: parseFile,
  createProjectPlanTemplate: createTemplate,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    onClick,
  }: {
    children: React.ReactNode;
    params: { id: string };
    onClick?: () => void;
  }) => (
    <a href={`/projects/${params.id}`} onClick={onClick}>
      {children}
    </a>
  ),
}));

type FileResult = { plan: ProjectImportPlan; warnings: string[]; unmappedStages: string[] };
const clients: QueryClient[] = [];
const imported = {
  project_id: "00000000-0000-4000-8000-000000000001",
  created: true,
  task_count: 1,
  approval_plan_count: 1,
  client_linked: false,
};
function parsedFile(name = "Example studio"): FileResult {
  const plan = parseProjectImport(JSON.stringify(projectImportFixture()), "example");
  plan.project_metadata.project_name = name;
  return { plan, warnings: [], unmappedStages: [] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <ProjectImportDialog />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Import project plan" }));
}
function openAdvanced() {
  fireEvent.click(screen.getByText("Advanced: prepared JSON"));
}
function jsonFile() {
  const contents = JSON.stringify(projectImportFixture());
  const file = new File([contents], "plan.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: () => Promise.resolve(contents) });
  return file;
}
function selectSpreadsheet(
  file = new File(["Task,Stage\nReview layout,2D Layout"], "plan.csv", { type: "text/csv" }),
) {
  const input = screen.getByLabelText("Excel or CSV plan") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  return { file, input };
}
function importForm() {
  return screen.getByRole("button", { name: /^Import project$/ }).closest("form")!;
}

beforeEach(() => {
  rpc.mockReset();
  parseFile.mockReset();
  createTemplate.mockReset();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  createTemplate.mockReturnValue({
    filename: "Spacenez_Project_Plan.csv",
    mime: "text/csv;charset=utf-8",
    contents: "Task,Stage\nExample,Planning & Brief\n",
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Advanced prepared JSON import", () => {
  it("blocks duplicate submits and opens the existing project returned by an idempotent retry", async () => {
    const response = deferred<unknown>();
    rpc.mockReturnValue(response.promise);
    show();
    openAdvanced();
    fireEvent.change(screen.getByLabelText("Prepared JSON file"), {
      target: { files: [jsonFile()] },
    });
    await screen.findByLabelText("Project name");
    const form = importForm();
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "import_project_plan",
      expect.objectContaining({
        p_source_sha256: "a".repeat(64),
        p_tasks: [
          expect.objectContaining({
            start_date: null,
            status: "not_started",
            source_metadata: expect.objectContaining({
              original: expect.objectContaining({ start_date: "same day" }),
            }),
          }),
        ],
      }),
    );
    await act(async () => {
      response.resolve({ data: { ...imported, created: false }, error: null });
    });
    expect(await screen.findByText(/already imported/)).toBeInTheDocument();
    expect(screen.getByText(/Client access is pending/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open project" })).toHaveAttribute(
      "href",
      `/projects/${imported.project_id}`,
    );
    expect(parseFile).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("requires explicit destination confirmation after migration", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://newbackend.supabase.co");
    show();
    openAdvanced();
    fireEvent.change(screen.getByLabelText("Prepared JSON file"), {
      target: { files: [jsonFile()] },
    });
    const submit = await screen.findByRole("button", { name: /^Import project$/ });
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest("form")!);
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /intended destination/ }));
    await waitFor(() => expect(submit).toBeEnabled());
  });
});

describe("Spreadsheet project import review", () => {
  it("reviews a normal CSV plan without backend details and preserves source text while importing a fresh unassigned plan", async () => {
    const result = parsedFile();
    result.plan.tasks[0]!.original.responsible = "Site lead from sheet";
    result.warnings = ["Owner text is preserved; assign actual people after import."];
    parseFile.mockResolvedValue(result);
    rpc.mockResolvedValue({ data: imported, error: null });
    show();
    expect(
      screen.getByRole("button", { name: "Download spreadsheet template" }),
    ).toBeInTheDocument();
    const { file } = selectSpreadsheet();
    await screen.findByLabelText("Project name");
    expect(parseFile).toHaveBeenCalledWith(file, "example");
    expect(screen.getByText(result.warnings[0]!)).toBeInTheDocument();
    expect(screen.getByText(/not started and unassigned/i)).toBeInTheDocument();
    expect(screen.queryByText(/Destination backend:/)).not.toBeInTheDocument();
    expect(screen.queryByText("example", { exact: true })).not.toBeInTheDocument();
    const previewSummary = screen.getByText("Review tasks and source notes");
    const previewDetails = previewSummary.closest("details");
    if (previewDetails && !previewDetails.open) fireEvent.click(previewSummary);
    const taskPreview = await screen.findByRole("region", { name: "Import task preview" });
    expect(within(taskPreview).getByText("Review layout")).toBeInTheDocument();
    expect(within(taskPreview).getByText(/Site lead from sheet/)).toBeInTheDocument();
    fireEvent.submit(importForm());
    await waitFor(() => expect(rpc).toHaveBeenCalledOnce());
    expect(rpc).toHaveBeenCalledWith(
      "import_project_plan",
      expect.objectContaining({
        p_tasks: [
          expect.objectContaining({
            title: "Review layout",
            stage: "layout_2d",
            status: "not_started",
            start_date: null,
            due_date: null,
            source_metadata: expect.objectContaining({
              original: expect.objectContaining({
                responsible: "Site lead from sheet",
                start_date: "same day",
              }),
            }),
          }),
        ],
      }),
    );
  });

  it("requires mapping an unknown source stage before creating the project", async () => {
    const result = parsedFile();
    result.plan.tasks[0]!.original.stage = "Custom stage";
    result.unmappedStages = ["Custom stage"];
    parseFile.mockResolvedValue(result);
    rpc.mockResolvedValue({ data: imported, error: null });
    show();
    selectSpreadsheet();
    const mapping = await screen.findByLabelText("Map stage “Custom stage”");
    expect(screen.getByRole("button", { name: /^Import project$/ })).toBeDisabled();
    fireEvent.submit(importForm());
    expect(rpc).not.toHaveBeenCalled();
    if (mapping.tagName === "SELECT") fireEvent.change(mapping, { target: { value: "execution" } });
    else {
      fireEvent.click(mapping);
      fireEvent.click(await screen.findByRole("option", { name: "Execution" }));
    }
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Import project$/ })).toBeEnabled(),
    );
    fireEvent.submit(importForm());
    await waitFor(() => expect(rpc).toHaveBeenCalledOnce());
    expect(rpc).toHaveBeenCalledWith(
      "import_project_plan",
      expect.objectContaining({
        p_tasks: [
          expect.objectContaining({
            stage: "execution",
            source_metadata: expect.objectContaining({
              original: expect.objectContaining({ stage: "Custom stage" }),
            }),
          }),
        ],
      }),
    );
  });

  it("keeps the latest file review when an earlier read finishes later", async () => {
    const earlier = deferred<FileResult>();
    parseFile
      .mockReturnValueOnce(earlier.promise)
      .mockResolvedValueOnce(parsedFile("Latest file project"));
    show();
    selectSpreadsheet(new File(["first"], "first.csv"));
    expect(screen.getByLabelText("Excel or CSV plan")).toBeEnabled();
    selectSpreadsheet(new File(["second"], "second.csv"));
    await waitFor(() =>
      expect(screen.getByLabelText("Project name")).toHaveValue("Latest file project"),
    );
    await act(async () => {
      earlier.resolve(parsedFile("Stale file project"));
    });
    expect(screen.getByLabelText("Project name")).toHaveValue("Latest file project");
    expect(parseFile).toHaveBeenCalledTimes(2);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("cancels a pending read when the dialog closes so it cannot repopulate a reopened dialog", async () => {
    const pending = deferred<FileResult>();
    parseFile
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(parsedFile("Fresh selection"));
    show();
    selectSpreadsheet();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Import project plan" }));
    await act(async () => {
      pending.resolve(parsedFile("Canceled file project"));
    });
    expect(screen.queryByLabelText("Project name")).not.toBeInTheDocument();
    selectSpreadsheet(new File(["fresh"], "fresh.csv"));
    await waitFor(() =>
      expect(screen.getByLabelText("Project name")).toHaveValue("Fresh selection"),
    );
  });

  it("resets the native file input so selecting the same file after an error parses it again", async () => {
    parseFile
      .mockRejectedValueOnce(new Error("Please check the date column"))
      .mockResolvedValueOnce(parsedFile());
    show();
    const input = screen.getByLabelText("Excel or CSV plan") as HTMLInputElement;
    const file = new File(["same contents"], "same-plan.csv");
    let nativeValue = "C:\\fakepath\\same-plan.csv";
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => nativeValue,
      set: (value: string) => {
        nativeValue = value;
      },
    });
    fireEvent.change(input, { target: { files: [file] } });
    expect(nativeValue).toBe("");
    await screen.findByText("Please check the date column");
    nativeValue = "C:\\fakepath\\same-plan.csv";
    fireEvent.change(input, { target: { files: [file] } });
    expect(nativeValue).toBe("");
    await screen.findByLabelText("Project name");
    expect(parseFile).toHaveBeenCalledTimes(2);
  });

  it("freezes an attempted import and retries the exact payload after an ambiguous error despite programmatic edits", async () => {
    parseFile.mockResolvedValue(parsedFile("Original import name"));
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: "Connection lost after submitting" } })
      .mockResolvedValueOnce({ data: { ...imported, created: false }, error: null });
    show();
    selectSpreadsheet();
    const name = await screen.findByLabelText("Project name");
    const email = screen.getByLabelText("Client email");
    const location = screen.getByLabelText("Location");
    const fileInput = screen.getByLabelText("Excel or CSV plan");
    const form = importForm();
    fireEvent.submit(form);
    await screen.findByText(/Connection lost after submitting/);
    expect(name).toBeDisabled();
    expect(email).toBeDisabled();
    expect(location).toBeDisabled();
    expect(fileInput).toBeDisabled();
    const payload = rpc.mock.calls[0]![1];
    fireEvent.change(name, { target: { value: "Changed name must not create another project" } });
    fireEvent.change(email, { target: { value: "changed@example.com" } });
    fireEvent.change(location, { target: { value: "Changed site" } });
    fireEvent.change(fileInput, { target: { files: [new File(["different"], "different.csv")] } });
    expect(name).toHaveValue("Original import name");
    expect(parseFile).toHaveBeenCalledOnce();
    fireEvent.submit(form);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(rpc.mock.calls[1]![1]).toEqual(payload);
    expect(await screen.findByText(/already imported/)).toBeInTheDocument();
  });
});
