import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectPayments } from "./ProjectPayments";
import { financeQueryKey, type FinanceBundle, type FinancePayment } from "@/lib/project-finance";
import { projectDay } from "@/lib/daily-updates";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  record: vi.fn(),
  review: vi.fn(),
  allocate: vi.fn(),
  upload: vi.fn(),
  discard: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/project-finance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/project-finance")>()),
  loadProjectFinance: mocks.load,
  saveProjectFinance: mocks.save,
  recordProjectPayment: mocks.record,
  reviewProjectPayment: mocks.review,
  allocateProjectPayment: mocks.allocate,
  uploadFinanceProof: mocks.upload,
  discardUnlinkedFinanceProof: mocks.discard,
  openFinanceProof: mocks.open,
}));

const PROJECT = "11111111-1111-4111-8111-111111111111";
const PAYMENT = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const MILESTONE = "44444444-4444-4444-8444-444444444444";
const clients: QueryClient[] = [];
function empty(access: FinanceBundle["access"] = "client"): FinanceBundle {
  return {
    access,
    configured: false,
    plan: null,
    summary: null,
    milestones: [],
    payments: [],
    allocations: [],
    audit: [],
  };
}
function configured(access: FinanceBundle["access"] = "client"): FinanceBundle {
  return {
    ...empty(access),
    configured: true,
    plan: {
      project_id: PROJECT,
      total_minor: 100_000_00,
      currency: "INR",
      quote_label: "Agreed renovation",
      scope_notes: "Agreed scope text",
      payment_instructions: "Use the agreed bank details",
      partner_summary_visible: false,
      version: 1,
    },
    summary: {
      received_minor: 0,
      refunded_minor: 0,
      net_received_minor: 0,
      pending_minor: 0,
      unallocated_minor: 0,
      outstanding_minor: 100_000_00,
      credit_minor: 0,
      due_now_minor: 30_000_00,
    },
    milestones: [
      {
        id: MILESTONE,
        project_id: PROJECT,
        label: "Booking",
        amount_minor: 30_000_00,
        due_date: null,
        due_condition: "On agreement",
        position: 0,
        is_due: true,
        has_history: false,
        paid_minor: 0,
      },
    ],
  };
}
function payment(patch: Partial<FinancePayment> = {}): FinancePayment {
  return {
    id: PAYMENT,
    project_id: PROJECT,
    kind: "receipt",
    purpose: "payment",
    amount_minor: 2550,
    paid_on: projectDay(),
    method: "UPI",
    reference: "Client reference",
    notes: "Client payment note",
    proof_path: null,
    related_payment_id: null,
    status: "reported",
    created_by: USER,
    created_at: "2026-11-21T05:00:00.000Z",
    verified_by: null,
    verified_at: null,
    review_reason: "",
    ...patch,
  };
}
async function show(value: FinanceBundle) {
  mocks.load.mockResolvedValue(value);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <ProjectPayments projectId={PROJECT} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { level: 2, name: "Payments" });
  return client;
}
function fillReport() {
  fireEvent.change(screen.getByLabelText("Amount paid (₹)"), { target: { value: "25.50" } });
  fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "UPI" } });
  fireEvent.change(screen.getByLabelText("Reference (optional)"), {
    target: { value: "UTR-example" },
  });
}
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.discard.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe("Project payments access and reports", () => {
  it("does not invent amounts or allow payment reporting before a plan is configured", async () => {
    await show(empty());
    expect(screen.getByText("The agreed payment plan has not been added yet.")).toBeInTheDocument();
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Report a payment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set up payment plan" })).not.toBeInTheDocument();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("keeps partner summary separate from client payment history and private notes", async () => {
    const value = configured("partner");
    value.payments = [payment({ proof_path: `${PROJECT}/${USER}/${PAYMENT}-proof.png` })];
    value.audit = [
      {
        id: PAYMENT,
        project_id: PROJECT,
        actor_id: USER,
        action: "insert",
        entity_type: "project_payments",
        entity_id: PAYMENT,
        created_at: "2026-11-21T05:00:00Z",
        details: {},
      },
    ];
    await show(value);
    expect(screen.getByRole("region", { name: "Payment summary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Payment milestones" })).toBeInTheDocument();
    expect(screen.queryByText("Agreed scope text")).not.toBeInTheDocument();
    expect(screen.queryByText("Client reference")).not.toBeInTheDocument();
    expect(screen.queryByText("Client payment note")).not.toBeInTheDocument();
    expect(screen.queryByText("Payment change history")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("submits a client report once and keeps it pending without changing confirmed paid", async () => {
    const value = configured();
    const next = {
      ...value,
      payments: [payment()],
      summary: { ...value.summary!, pending_minor: 2550 },
    };
    let finish!: (value: FinanceBundle) => void;
    mocks.record.mockImplementation(
      () =>
        new Promise<FinanceBundle>((resolve) => {
          finish = resolve;
        }),
    );
    await show(value);
    fireEvent.click(screen.getByRole("button", { name: "Report a payment" }));
    fillReport();
    const form = screen.getByRole("form", { name: "Report payment" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(mocks.record).toHaveBeenCalledOnce());
    expect(mocks.record).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({
        kind: "receipt",
        purpose: "payment",
        amount_minor: 2550,
        reference: "UTR-example",
      }),
      [],
    );
    expect(screen.getByLabelText("Amount paid (₹)")).toBeDisabled();
    mocks.load.mockResolvedValue(next);
    await act(async () => {
      finish(next);
    });
    await screen.findByText("Awaiting confirmation");
    const summary = screen.getByRole("region", { name: "Payment summary" });
    expect(within(summary).getByText("Confirmed paid").nextElementSibling).toHaveTextContent(
      "₹0.00",
    );
    expect(screen.queryByRole("button", { name: "Confirm payment" })).not.toBeInTheDocument();
    expect(
      screen.getByText("Payment reported. It will count as paid after Spacenez confirms it."),
    ).toBeInTheDocument();
  });

  it("retains report drafts, proof and retry identity after an ambiguous failure and background refresh", async () => {
    const value = configured();
    const client = await show(value);
    const path = `${PROJECT}/${USER}/${PAYMENT}-proof.png`;
    mocks.upload.mockResolvedValue(path);
    mocks.record.mockRejectedValue(new Error("Connection lost"));
    fireEvent.click(screen.getByRole("button", { name: "Report a payment" }));
    fillReport();
    fireEvent.change(screen.getByLabelText("Notes (optional)"), {
      target: { value: "Keep my note" },
    });
    fireEvent.change(screen.getByLabelText("Payment proof (optional)"), {
      target: { files: [new File(["proof"], "proof.png", { type: "image/png" })] },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Report payment" }));
    await screen.findByText("Connection lost");
    const first = mocks.record.mock.calls[0]![1];
    await act(async () => {
      client.setQueryData(financeQueryKey(PROJECT), {
        ...value,
        plan: { ...value.plan!, version: 2 },
      });
    });
    expect(screen.getByLabelText("Amount paid (₹)")).toHaveValue("25.50");
    expect(screen.getByLabelText("Notes (optional)")).toHaveValue("Keep my note");
    fireEvent.submit(screen.getByRole("form", { name: "Report payment" }));
    await waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(2));
    expect(mocks.record.mock.calls[1]![1]).toEqual(first);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Report payment" })).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("Amount paid (₹)"), { target: { value: "26.50" } });
    fireEvent.change(screen.getByLabelText("Notes (optional)"), {
      target: { value: "Edited note after failed save" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Report payment" }));
    await waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(3));
    expect(mocks.record.mock.calls[2]![1]).toEqual(
      expect.objectContaining({
        id: first.id,
        amount_minor: 2650,
        notes: "Edited note after failed save",
        proof_path: path,
      }),
    );
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.discard).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.discard).toHaveBeenCalledWith(PROJECT, path);
  });
});

describe("Agreed payment administration", () => {
  it("shows a possibly saved receipt after a lost response and keeps its draft without allowing another submission", async () => {
    const value = configured("admin");
    mocks.record.mockImplementationOnce(async (_projectId, input) => {
      const saved: FinanceBundle = {
        ...value,
        payments: [
          payment({
            ...input,
            status: "confirmed",
            verified_by: USER,
            verified_at: "2026-11-21T05:00:00Z",
          }),
        ],
        summary: {
          ...value.summary!,
          received_minor: input.amount_minor,
          net_received_minor: input.amount_minor,
          unallocated_minor: input.amount_minor,
          outstanding_minor: value.plan!.total_minor - input.amount_minor,
          due_now_minor: value.summary!.due_now_minor - input.amount_minor,
        },
      };
      mocks.load.mockResolvedValue(saved);
      throw new Error("The response was lost");
    });
    await show(value);
    fireEvent.click(screen.getByRole("button", { name: "Record received payment" }));
    fireEvent.change(screen.getByLabelText("Amount received (₹)"), { target: { value: "100.00" } });
    fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "UPI" } });
    fireEvent.change(screen.getByLabelText("Reference (optional)"), {
      target: { value: "Receipt-check-reference" },
    });
    fireEvent.change(screen.getByLabelText("Notes (optional)"), {
      target: { value: "Keep the draft visible" },
    });
    const form = screen.getByRole("form", { name: "Record received payment" });
    fireEvent.submit(form);
    await screen.findByText(
      "This payment is already recorded. Close this form to review its history; changes here have not been saved.",
    );
    expect(screen.getByText("Receipt-check-reference")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount received (₹)")).toHaveValue("100.00");
    expect(screen.getByLabelText("Notes (optional)")).toHaveValue("Keep the draft visible");
    expect(screen.getByRole("button", { name: "Save received payment" })).toBeDisabled();
    fireEvent.submit(form);
    expect(mocks.record).toHaveBeenCalledOnce();
    const summary = screen.getByRole("region", { name: "Payment summary" });
    expect(within(summary).getByText("Confirmed paid").nextElementSibling).toHaveTextContent(
      "₹100.00",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Record received payment" })).not.toBeInTheDocument();
    expect(screen.getByText("Receipt-check-reference")).toBeInTheDocument();
  });

  it("starts with blank amounts and an opt-in partner summary, applying a percentage schedule only on request", async () => {
    mocks.save.mockResolvedValue(configured("admin"));
    await show(empty("admin"));
    fireEvent.click(screen.getByRole("button", { name: "Set up payment plan" }));
    expect(screen.getByLabelText("Agreed project total (₹)")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: /Share payment totals/ })).not.toBeChecked();
    const template = screen.getByRole("button", { name: "Use 30 / 25 / 25 / 20 schedule" });
    expect(template).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Agreed project total (₹)"), {
      target: { value: "1000.01" },
    });
    expect(screen.queryByLabelText("Milestone 1 amount (₹)")).not.toBeInTheDocument();
    fireEvent.click(template);
    expect(screen.getByLabelText("Milestone 1 amount (₹)")).toHaveValue("300.00");
    expect(screen.getByLabelText("Milestone 4 amount (₹)")).toHaveValue("200.01");
    fireEvent.submit(screen.getByRole("form", { name: "Agreed payment plan" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save).toHaveBeenCalledWith(
      PROJECT,
      0,
      expect.objectContaining({
        total_minor: 100001,
        currency: "INR",
        partner_summary_visible: false,
      }),
      expect.any(Array),
    );
    expect(
      mocks.save.mock.calls[0]![3].reduce(
        (sum: number, row: { amount_minor: number }) => sum + row.amount_minor,
        0,
      ),
    ).toBe(100001);
  });

  it("preserves a plan draft after a background change and requires an explicit reload before saving", async () => {
    const value = configured("admin");
    const client = await show(value);
    fireEvent.click(screen.getByRole("button", { name: "Edit payment plan" }));
    fireEvent.change(screen.getByLabelText("Agreed project total (₹)"), {
      target: { value: "90000.00" },
    });
    await act(async () => {
      client.setQueryData(financeQueryKey(PROJECT), {
        ...value,
        plan: { ...value.plan!, version: 2, total_minor: 12000000 },
      });
    });
    expect(screen.getByLabelText("Agreed project total (₹)")).toHaveValue("90000.00");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save payment plan" })).toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Load latest payment plan" }));
    expect(screen.getByLabelText("Agreed project total (₹)")).toHaveValue("120000.00");
    expect(screen.getByRole("button", { name: "Save payment plan" })).toBeEnabled();
  });

  it("focuses one review editor and hides other payment workflows so reasons cannot cross records", async () => {
    const value = configured("admin");
    value.payments = [
      payment(),
      payment({ id: "55555555-5555-4555-8555-555555555555", reference: "Second report" }),
    ];
    mocks.review.mockRejectedValue(new Error("Please retry verification"));
    await show(value);
    fireEvent.click(screen.getAllByRole("button", { name: "Reject report" })[0]!);
    expect(screen.getByRole("region", { name: "Payment editor" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Confirm payment" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Record received payment" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Reject report" })).toHaveLength(1);
    expect(screen.getByLabelText("Reason")).toHaveAttribute("maxlength", "1000");
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Reference does not match" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Review payment" }));
    await screen.findByText("Please retry verification");
    expect(mocks.review).toHaveBeenCalledWith(
      PAYMENT,
      "reject",
      "Reference does not match",
      undefined,
    );
    expect(screen.getByLabelText("Reason")).toHaveValue("Reference does not match");
    expect(screen.getByText("This review note is visible to the client.")).toBeInTheDocument();
  });

  it("refreshes the authoritative plan after a rejected save while retaining the draft", async () => {
    const value = configured("admin");
    mocks.save.mockRejectedValue(new Error("A newer plan was saved"));
    await show(value);
    fireEvent.click(screen.getByRole("button", { name: "Edit payment plan" }));
    fireEvent.change(screen.getByLabelText("Agreed project total (₹)"), {
      target: { value: "90000.00" },
    });
    mocks.load.mockResolvedValue({
      ...value,
      plan: { ...value.plan!, version: 2, total_minor: 12000000 },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Agreed payment plan" }));
    await screen.findByText("A newer plan was saved");
    await screen.findByRole("button", { name: "Load latest payment plan" });
    expect(screen.getByRole("button", { name: "Save payment plan" })).toBeDisabled();
    expect(screen.getByLabelText("Agreed project total (₹)")).toHaveValue("90000.00");
    expect(screen.getByRole("button", { name: "Load latest payment plan" })).toBeInTheDocument();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.load).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Load latest payment plan" }));
    expect(screen.getByLabelText("Agreed project total (₹)")).toHaveValue("120000.00");
  });
});
