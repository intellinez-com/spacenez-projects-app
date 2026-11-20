import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyStatus, type DailyStatusProps } from "./DailyStatus";
import { projectDay, dailyUpdateBounds, type DailyUpdate } from "@/lib/daily-updates";
import type { Doc, Task } from "./data";

const mocks = vi.hoisted(() => ({ load: vi.fn(), from: vi.fn(), insert: vi.fn(), save: vi.fn(), previous: vi.fn(), getUser: vi.fn(), openDoc: vi.fn() }));
vi.mock("@/lib/daily-updates", async (original) => ({ ...await original<typeof import("@/lib/daily-updates")>(), loadDailyUpdates: mocks.load }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, auth: { getUser: mocks.getUser } } }));
vi.mock("./data", async (original) => ({ ...await original<typeof import("./data")>(), openDoc: mocks.openDoc }));

const clients: QueryClient[] = [];
let records: DailyUpdate[];
const today = () => projectDay();
function day(offset: number) { return projectDay(new Date(new Date(`${today()}T12:00:00+05:30`).getTime() + offset * 86_400_000)); }
function report(overrides: Partial<DailyUpdate> = {}): DailyUpdate {
  return { id: "report-a", project_id: "project-a", report_date: today(), work_done: "The kitchen measurements were checked.", next_steps: "Prepare the revised layout.", blockers: "Waiting for the appliance dimensions.", created_by: "editor-a", created_at: `${today()}T11:00:00+05:30`, author: { full_name: "Sample Designer", email: "designer@example.test" }, ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks(); records = [];
  const query = { insert: mocks.insert, select: vi.fn().mockReturnThis(), single: mocks.save, eq: vi.fn().mockReturnThis(), maybeSingle: mocks.previous };
  mocks.from.mockReturnValue(query); mocks.insert.mockReturnValue(query);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "editor-a" } }, error: null });
  mocks.save.mockResolvedValue({ data: report(), error: null });
  mocks.load.mockImplementation(async (projectId: string, options: { period: "today" | "week" | "all"; offset?: number; limit?: number; now?: Date }) => {
    const bounds = dailyUpdateBounds(options.period, options.now);
    return records.filter((row) => row.project_id === projectId && row.report_date <= bounds.to && (!bounds.from || row.report_date >= bounds.from)).sort((left, right) => right.report_date.localeCompare(left.report_date) || right.created_at.localeCompare(left.created_at)).slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 50));
  });
});
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); clients.length = 0; vi.useRealTimers(); });

function renderStatus(overrides: Partial<DailyStatusProps> = {}) {
  const props: DailyStatusProps = { projectId: "project-a", tasks: [], documents: [], canEdit: false, onOpenTask: vi.fn(), onOpenFiles: vi.fn(), ...overrides };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  const view = render(<QueryClientProvider client={client}><DailyStatus {...props} /></QueryClientProvider>);
  return { props, client, view };
}
async function openComposer() {
  fireEvent.click(screen.getByRole("button", { name: "Post daily update" }));
  const input = await screen.findByLabelText("Work done / progress");
  fireEvent.change(input, { target: { value: "  Site measurements completed.  " } });
  fireEvent.change(screen.getByLabelText("Next steps (optional)"), { target: { value: "  Review the drawing.  " } });
  fireEvent.change(screen.getByLabelText("Delays / blockers (optional)"), { target: { value: "  Vendor arrived late.  " } });
  return screen.getByRole("button", { name: "Share with client" }).closest("form")!;
}

describe("Client daily status", () => {
  it("opens on today's team reports, shows work/next steps/delays, and switches to dated history", async () => {
    records = [report(), report({ id: "older", report_date: day(-8), work_done: "The first site visit was completed.", next_steps: "", blockers: "" })];
    renderStatus();
    expect(screen.getByRole("button", { name: "Today", pressed: true })).toBeInTheDocument();
    expect(await screen.findByText("The kitchen measurements were checked.")).toBeInTheDocument();
    expect(screen.getByText("Prepare the revised layout.")).toBeInTheDocument();
    expect(screen.getByText("Waiting for the appliance dimensions.")).toBeInTheDocument();
    expect(screen.getByText(/Sample Designer/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Post daily update" })).not.toBeInTheDocument();
    expect(screen.queryByText("The first site visit was completed.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith("project-a", expect.objectContaining({ period: "week", offset: 0, limit: 50 })));
    expect(screen.queryByText("The first site visit was completed.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "So far" }));
    expect(await screen.findByText("The first site visit was completed.")).toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("distinguishes an unposted day from the last report and keeps task totals explicitly overall", async () => {
    records = [report({ report_date: day(-1), work_done: "Yesterday's layout was shared." })];
    const tasks = [
      { id: "done", project_id: "project-a", title: "Survey", status: "done", position: 0, due_date: null, updated_at: new Date().toISOString() },
      { id: "blocked", project_id: "project-a", title: "Select kitchen finish", status: "blocked", position: 1, due_date: day(-1) },
      { id: "foreign", project_id: "other-project", title: "Private work", status: "done", position: 0, due_date: null },
    ] as Task[];
    const { props } = renderStatus({ tasks });
    expect(await screen.findByText("No daily update posted today.")).toBeInTheDocument();
    expect(screen.getByText("Last reported progress")).toBeInTheDocument();
    expect(screen.getByText("Yesterday's layout was shared.")).toBeInTheDocument();
    expect(screen.getByText("Overall progress so far")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 (50%)")).toBeInTheDocument();
    expect(screen.queryByText(/completed today/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no work happened/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Private work")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Select kitchen finish/ }));
    expect(props.onOpenTask).toHaveBeenCalledWith(tasks[1]);
    fireEvent.click(screen.getByRole("button", { name: "See previous updates" }));
    expect(screen.getByRole("button", { name: "So far", pressed: true })).toBeInTheDocument();
  });

  it("uses India upload dates and signed opening for files, without mixing another project's paths", async () => {
    const documents = [
      { id: "today", project_id: "project-a", name: "Kitchen photo.jpg", path: "project-a/today.jpg", created_at: `${today()}T00:10:00+05:30`, size: 100 },
      { id: "yesterday", project_id: "project-a", name: "Old photo.jpg", path: "project-a/yesterday.jpg", created_at: `${day(-1)}T23:59:00+05:30`, size: 100 },
      { id: "foreign", project_id: "other-project", name: "Other project.jpg", path: "other-project/private.jpg", created_at: `${today()}T01:00:00+05:30`, size: 100 },
      { id: "badpath", project_id: "project-a", name: "Unrelated file.jpg", path: "other-project/file.jpg", created_at: `${today()}T01:00:00+05:30`, size: 100 },
    ] as Doc[];
    const { props } = renderStatus({ documents });
    await screen.findByText("No daily update posted today.");
    expect(screen.getByRole("heading", { name: "Files shared today" })).toBeInTheDocument();
    expect(screen.queryByText("Old photo.jpg")).not.toBeInTheDocument();
    expect(screen.queryByText("Other project.jpg")).not.toBeInTheDocument();
    expect(screen.queryByText("Unrelated file.jpg")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Kitchen photo.jpg/ }));
    expect(mocks.openDoc).toHaveBeenCalledWith("project-a/today.jpg");
    fireEvent.click(screen.getByRole("button", { name: "All photos & files" }));
    expect(props.onOpenFiles).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "So far" }));
    expect(screen.getByText("Old photo.jpg")).toBeInTheDocument();
  });

  it("preserves a failed team draft, blocks duplicate submits, and keeps a saved report visible when refresh fails", async () => {
    mocks.save.mockResolvedValueOnce({ data: null, error: { message: "Connection interrupted" } });
    const { client } = renderStatus({ canEdit: true });
    await screen.findByText("No daily update posted today.");
    const form = await openComposer();
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
    expect(screen.getByLabelText("Work done / progress")).toHaveValue("  Site measurements completed.  ");
    expect(screen.getByLabelText("Delays / blockers (optional)")).toHaveValue("  Vendor arrived late.  ");
    let finish!: (value: { data: DailyUpdate; error: null }) => void;
    mocks.save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const refresh = vi.spyOn(client, "invalidateQueries").mockRejectedValue(new Error("Refresh unavailable"));
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(mocks.insert).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Posting daily update…" })).toBeDisabled();
    const firstPayload = mocks.insert.mock.calls[0]![0];
    const retryPayload = mocks.insert.mock.calls[1]![0];
    expect(retryPayload).toEqual(firstPayload);
    expect(retryPayload).toMatchObject({ project_id: "project-a", report_date: today(), work_done: "Site measurements completed.", next_steps: "Review the drawing.", blockers: "Vendor arrived late.", created_by: "editor-a" });
    await act(async () => { finish({ data: report({ id: retryPayload.id, work_done: retryPayload.work_done, next_steps: retryPayload.next_steps, blockers: retryPayload.blockers }), error: null }); });
    expect(await screen.findByRole("status")).toHaveTextContent("Daily update posted.");
    expect(screen.getByText("Site measurements completed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share with client" })).not.toBeInTheDocument();
    expect(screen.queryByText("Refresh unavailable")).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalledWith({ queryKey: ["daily-updates"] });
  });

  it("recovers the same report after an interrupted response instead of creating another on retry", async () => {
    mocks.save.mockResolvedValueOnce({ data: null, error: { message: "Response interrupted" } }).mockResolvedValueOnce({ data: null, error: { code: "23505", message: "Already exists" } });
    renderStatus({ canEdit: true }); await screen.findByText("No daily update posted today.");
    const form = await openComposer(); fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveTextContent("Response interrupted");
    const payload = mocks.insert.mock.calls[0]![0];
    mocks.previous.mockResolvedValue({ data: report({ ...payload }), error: null });
    fireEvent.submit(form);
    expect(await screen.findByRole("status")).toHaveTextContent("Daily update posted.");
    expect(mocks.insert.mock.calls[1]![0].id).toBe(payload.id);
    expect(mocks.previous).toHaveBeenCalledOnce();
    expect(screen.getAllByText("Site measurements completed.")).toHaveLength(1);
  });

  it("rejects a future work date and requires an authenticated author without discarding the draft", async () => {
    renderStatus({ canEdit: true }); await screen.findByText("No daily update posted today.");
    const form = await openComposer();
    fireEvent.change(screen.getByLabelText("Work date"), { target: { value: day(1) } });
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a valid work date up to today");
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    fireEvent.change(screen.getByLabelText("Work date"), { target: { value: today() } });
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your session has expired");
    expect(screen.getByLabelText("Work done / progress")).toHaveValue("  Site measurements completed.  ");
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("keeps the team form available through loading errors and period changes", async () => {
    mocks.load.mockRejectedValue(new Error("Service unavailable"));
    renderStatus({ canEdit: true });
    await screen.findByRole("button", { name: "Retry daily updates" });
    await openComposer();
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith("project-a", expect.objectContaining({ period: "week" })));
    expect(screen.getByLabelText("Work done / progress")).toHaveValue("  Site measurements completed.  ");
    expect(screen.getByRole("button", { name: "Share with client" })).toBeEnabled();
    mocks.load.mockResolvedValue([]);
    fireEvent.click(await screen.findByRole("button", { name: "Retry daily updates" }));
    expect(await screen.findByText("No daily updates posted this week.")).toBeInTheDocument();
    expect(screen.getByLabelText("Delays / blockers (optional)")).toHaveValue("  Vendor arrived late.  ");
  });

  it("defaults an untouched composer to the new India day while preserving a chosen date and unsent text", async () => {
    // Stub only Date: React Query and Testing Library continue using real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T23:59:00+05:30"));
    renderStatus({ canEdit: true });
    await screen.findByText("No daily update posted today.");

    vi.setSystemTime(new Date("2026-11-21T00:01:00+05:30"));
    act(() => { window.dispatchEvent(new Event("focus")); });
    fireEvent.click(screen.getByRole("button", { name: "Post daily update" }));
    expect(screen.getByLabelText("Work date")).toHaveValue("2026-11-21");
    expect(screen.getByLabelText("Work date")).toHaveAttribute("max", "2026-11-21");

    fireEvent.change(screen.getByLabelText("Work date"), { target: { value: "2026-11-20" } });
    fireEvent.change(screen.getByLabelText("Work done / progress"), { target: { value: "Keep yesterday's site update draft." } });
    fireEvent.click(screen.getByRole("button", { name: "Close daily update" }));
    vi.setSystemTime(new Date("2026-11-22T00:01:00+05:30"));
    act(() => { window.dispatchEvent(new Event("focus")); });
    fireEvent.click(screen.getByRole("button", { name: "Post daily update" }));
    expect(screen.getByLabelText("Work date")).toHaveValue("2026-11-20");
    expect(screen.getByLabelText("Work date")).toHaveAttribute("max", "2026-11-22");
    expect(screen.getByLabelText("Work done / progress")).toHaveValue("Keep yesterday's site update draft.");
  });

  it("pages earlier reports without presenting a partial history as complete", async () => {
    records = Array.from({ length: 51 }, (_, index) => report({ id: `report-${index}`, report_date: day(-1 - index), work_done: `Report number ${index}`, next_steps: "", blockers: "" }));
    renderStatus();
    await screen.findByText("No daily update posted today.");
    fireEvent.click(screen.getByRole("button", { name: "So far" }));
    fireEvent.click(await screen.findByRole("button", { name: "Older daily updates" }));
    expect(await screen.findByText("Report number 50")).toBeInTheDocument();
    expect(mocks.load).toHaveBeenCalledWith("project-a", expect.objectContaining({ period: "all", offset: 50, limit: 50 }));
    expect(screen.getByRole("button", { name: "Newer daily updates" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Older daily updates" })).not.toBeInTheDocument();
    const region = screen.getByRole("region", { name: "Daily status" });
    expect(within(region).queryByText("Report number 0")).not.toBeInTheDocument();
  });
});
