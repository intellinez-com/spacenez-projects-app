import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  allocateProjectPayment,
  assertFinanceProofPath,
  createFinanceRetryIdentity,
  discardUnlinkedFinanceProof,
  financeQueryKey,
  FINANCE_MAX_MINOR,
  FINANCE_PROOF_BUCKET,
  formatMoney,
  formatMoneyInput,
  loadProjectFinance,
  openFinanceProof,
  parseMoneyToPaise,
  parseProjectFinanceBundle,
  recordProjectPayment,
  reviewProjectPayment,
  saveProjectFinance,
  uploadFinanceProof,
  type FinanceBundle,
  type FinancePaymentInput,
} from "./project-finance";

const { rpc, getUser, storageFrom, upload, createSignedUrl, remove } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  storageFrom: vi.fn(),
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc, auth: { getUser }, storage: { from: storageFrom } },
}));

const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT = "22222222-2222-4222-8222-222222222222";
const PERSON = "33333333-3333-4333-8333-333333333333";
const MILESTONE = "44444444-4444-4444-8444-444444444444";
const PAYMENT = "55555555-5555-4555-8555-555555555555";
const PROOF_ID = "66666666-6666-4666-8666-666666666666";
const PROOF = `${PROJECT}/${PERSON}/${PROOF_ID}-receipt.pdf`;
const WHEN = "2026-11-21T10:00:00+00:00";

function bundle(): FinanceBundle {
  return {
    access: "admin",
    configured: true,
    plan: {
      project_id: PROJECT,
      total_minor: 10000,
      currency: "INR",
      quote_label: "Agreed quotation",
      scope_notes: "Fictional test scope",
      payment_instructions: "Fictional instructions",
      version: 1,
      partner_summary_visible: false,
      created_by: PERSON,
      created_at: WHEN,
      updated_by: PERSON,
      updated_at: WHEN,
    },
    milestones: [
      {
        id: MILESTONE,
        project_id: PROJECT,
        label: "Booking",
        amount_minor: 10000,
        due_date: null,
        due_condition: "On acceptance",
        position: 0,
        is_due: true,
        has_history: false,
        paid_minor: 0,
      },
    ],
    payments: [],
    allocations: [],
    audit: [],
    summary: {
      received_minor: 0,
      refunded_minor: 0,
      net_received_minor: 0,
      pending_minor: 0,
      unallocated_minor: 0,
      outstanding_minor: 10000,
      credit_minor: 0,
      due_now_minor: 10000,
    },
  };
}

function payment(): FinancePaymentInput {
  return {
    id: PAYMENT,
    kind: "receipt",
    purpose: "advance",
    amount_minor: 2000,
    paid_on: "2026-11-21",
    method: "Bank transfer",
    reference: "TEST-REFERENCE",
    notes: "Fictional unit test",
    proof_path: null,
    related_payment_id: null,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  rpc.mockResolvedValue({ data: bundle(), error: null });
  getUser.mockResolvedValue({ data: { user: { id: PERSON } }, error: null });
  storageFrom.mockReturnValue({ upload, createSignedUrl, remove });
  upload.mockResolvedValue({ data: {}, error: null });
  createSignedUrl.mockResolvedValue({
    data: { signedUrl: "https://example.test/private-proof" },
    error: null,
  });
  remove.mockResolvedValue({ data: [], error: null });
});

describe("exact rupee/paise amounts", () => {
  it("parses decimal text exactly, including the maximum and single-paise values", () => {
    expect(parseMoneyToPaise(" 0.01 ")).toBe(1);
    expect(parseMoneyToPaise("12345678.29")).toBe(1234567829);
    expect(parseMoneyToPaise("0010.2")).toBe(1020);
    expect(parseMoneyToPaise("10000000000")).toBe(FINANCE_MAX_MINOR);
    expect(parseMoneyToPaise("0")).toBe(0);
  });
  it.each([
    "",
    "-1",
    "+1",
    "1.001",
    "1e3",
    "₹100",
    "1,000",
    ".50",
    "1.",
    "NaN",
    "10000000000.01",
    "9".repeat(100),
  ])("rejects ambiguous or out-of-range amount %s", (value) => {
    expect(() => parseMoneyToPaise(value)).toThrow();
  });
  it("formats integer paise without dropping fractional precision", () => {
    expect(formatMoney(123456789)).toBe("₹12,34,567.89");
    expect(formatMoney(-1)).toBe("-₹0.01");
    expect(formatMoneyInput(FINANCE_MAX_MINOR - 1)).toBe("9999999999.99");
    expect(parseMoneyToPaise(formatMoneyInput(FINANCE_MAX_MINOR - 1))).toBe(FINANCE_MAX_MINOR - 1);
    expect(() => formatMoney(0.5)).toThrow();
  });
});

describe("finance bundle boundary", () => {
  it("keeps an unconfigured project unset rather than creating a zero quote", () => {
    const result = {
      access: "client",
      configured: false,
      plan: null,
      summary: null,
      milestones: [],
      payments: [],
      allocations: [],
      audit: [],
    };
    expect(parseProjectFinanceBundle(result, PROJECT)).toEqual(result);
    expect(() =>
      parseProjectFinanceBundle({ ...result, summary: bundle().summary }, PROJECT),
    ).toThrow();
  });
  it("validates safe integers, calendar dates and cross-project records", () => {
    const unsafe = bundle();
    unsafe.plan!.total_minor = Number.MAX_SAFE_INTEGER + 1;
    expect(() => parseProjectFinanceBundle(unsafe, PROJECT)).toThrow();
    const invalidDate = bundle();
    invalidDate.milestones[0]!.due_date = "2026-02-30";
    expect(() => parseProjectFinanceBundle(invalidDate, PROJECT)).toThrow();
    const other = bundle();
    other.milestones[0]!.project_id = OTHER_PROJECT;
    expect(() => parseProjectFinanceBundle(other, PROJECT)).toThrow();
    expect(() => parseProjectFinanceBundle(other)).toThrow();
  });
  it("accepts only the redacted opt-in partner view and excludes client audits", () => {
    const partner = bundle();
    partner.access = "partner";
    partner.plan = {
      project_id: PROJECT,
      total_minor: 10000,
      currency: "INR",
      quote_label: "Agreed",
      version: 1,
      partner_summary_visible: true,
    };
    expect(parseProjectFinanceBundle(partner, PROJECT).access).toBe("partner");
    partner.plan.payment_instructions = "Private account instructions";
    expect(() => parseProjectFinanceBundle(partner, PROJECT)).toThrow();
    const client = bundle();
    client.access = "client";
    client.audit = [
      {
        id: PROOF_ID,
        project_id: PROJECT,
        actor_id: PERSON,
        action: "test",
        entity_type: "plan",
        entity_id: null,
        created_at: WHEN,
        details: {},
      },
    ];
    expect(() => parseProjectFinanceBundle(client, PROJECT)).toThrow();
  });
  it("rejects unknown private payload fields and dangling allocation references", () => {
    const record = {
      ...payment(),
      project_id: PROJECT,
      status: "reported",
      created_by: PERSON,
      created_at: WHEN,
      verified_by: null,
      verified_at: null,
      review_reason: "",
      request_payload: { private: true },
    };
    expect(() => parseProjectFinanceBundle({ ...bundle(), payments: [record] }, PROJECT)).toThrow();
    const allocated = bundle();
    allocated.allocations = [
      { project_id: PROJECT, payment_id: PAYMENT, milestone_id: MILESTONE, amount_minor: 100 },
    ];
    expect(() => parseProjectFinanceBundle(allocated, PROJECT)).toThrow();
  });
});

describe("RPC commands and safe retries", () => {
  it("loads project-scoped RPC data and reports deployment errors", async () => {
    await expect(loadProjectFinance(PROJECT)).resolves.toEqual(bundle());
    expect(rpc).toHaveBeenCalledWith("get_project_finance", { p_project_id: PROJECT });
    expect(financeQueryKey(PROJECT)).toEqual(["project-finance", PROJECT]);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "not found" } });
    await expect(loadProjectFinance(PROJECT)).rejects.toThrow("database update");
  });
  it("allows incomplete schedules, caps milestones at the quote and passes the optimistic version", async () => {
    const draft = bundle();
    const plan = {
      total_minor: 10000,
      currency: "INR" as const,
      quote_label: "Agreed",
      scope_notes: "",
      payment_instructions: "",
      partner_summary_visible: false,
    };
    const milestones = draft.milestones.map(
      ({ project_id: _project, paid_minor: _paid, has_history: _history, ...item }) => item,
    );
    await saveProjectFinance(PROJECT, 0, plan, milestones);
    expect(rpc).toHaveBeenCalledWith("save_project_finance", {
      p_project_id: PROJECT,
      p_expected_version: 0,
      p_plan: plan,
      p_milestones: milestones,
    });
    await expect(
      saveProjectFinance(PROJECT, 1, { ...plan, total_minor: 9999 }, milestones),
    ).rejects.toThrow("exceed");
    await expect(saveProjectFinance(PROJECT, 1, plan, [])).resolves.toEqual(bundle());
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("retains the caller's receipt ID and never confirms client reports locally", async () => {
    await recordProjectPayment(PROJECT, payment());
    expect(rpc).toHaveBeenCalledWith("record_project_payment", {
      p_project_id: PROJECT,
      p_payment: payment(),
      p_allocations: [],
    });
    await expect(recordProjectPayment(PROJECT, { ...payment(), kind: "refund" })).rejects.toThrow(
      "original receipt",
    );
    await expect(
      recordProjectPayment(PROJECT, payment(), [{ milestone_id: MILESTONE, amount_minor: 2001 }]),
    ).rejects.toThrow("exceed");
    expect(rpc).toHaveBeenCalledOnce();
  });
  it("preserves omitted review allocations and rejects duplicate allocations", async () => {
    await reviewProjectPayment(PAYMENT, "confirm", "");
    expect(rpc).toHaveBeenCalledWith("review_project_payment", {
      p_payment_id: PAYMENT,
      p_decision: "confirm",
      p_reason: "",
    });
    await reviewProjectPayment(PAYMENT, "confirm", "", []);
    expect(rpc).toHaveBeenLastCalledWith("review_project_payment", {
      p_payment_id: PAYMENT,
      p_decision: "confirm",
      p_reason: "",
      p_allocations: [],
    });
    await expect(
      allocateProjectPayment(PAYMENT, [
        { milestone_id: MILESTONE, amount_minor: 1 },
        { milestone_id: MILESTONE, amount_minor: 2 },
      ]),
    ).rejects.toThrow("only once");
  });
  it("keeps one draft ID across edits after an uncertain save and changes it only after reset", () => {
    const identity = createFinanceRetryIdentity();
    const first = identity.forPayload({ project: PROJECT, amount: 100, nested: { b: 2, a: 1 } });
    expect(identity.forPayload({ nested: { a: 1, b: 2 }, amount: 100, project: PROJECT })).toBe(
      first,
    );
    const changed = identity.forPayload({ project: PROJECT, amount: 200 });
    expect(changed).toBe(first);
    identity.reset();
    expect(identity.forPayload({ project: PROJECT, amount: 200 })).not.toBe(changed);
    expect(() => identity.forPayload({ amount: NaN })).toThrow();
  });
  it("turns an edited retry conflict into a payment-history check without exposing IDs", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: `Payment ${PAYMENT} already exists` },
    });
    await expect(recordProjectPayment(PROJECT, payment())).rejects.toMatchObject({
      message:
        "This payment may already be saved with different details. Refresh payments and check history.",
    });
  });
});

describe("private payment proofs", () => {
  it.each([
    `${OTHER_PROJECT}/${PERSON}/${PROOF_ID}-receipt.pdf`,
    `${PROJECT}/../${PROOF_ID}-receipt.pdf`,
    `${PROJECT}/${PERSON}/../receipt.pdf`,
    `${PROJECT}/${PERSON}/${PROOF_ID}-receipt.pdf?public=true`,
    `${PROJECT}/${PERSON}/${PROOF_ID}-receipt%2f.pdf`,
    `https://example.test/${PROJECT}/${PERSON}/${PROOF_ID}-receipt.pdf`,
  ])("rejects non-project or unsafe proof paths %s", (path) => {
    expect(() => assertFinanceProofPath(PROJECT, path)).toThrow();
  });
  it("uploads only approved proof types under the authenticated owner's folder", async () => {
    const file = new File(["fictional receipt"], "receipt 1.pdf", { type: "application/pdf" });
    const path = await uploadFinanceProof(PROJECT, file);
    expect(path).toMatch(new RegExp(`^${PROJECT}/${PERSON}/[0-9a-f-]{36}-receipt_1\\.pdf$`));
    expect(storageFrom).toHaveBeenCalledWith(FINANCE_PROOF_BUCKET);
    expect(upload).toHaveBeenCalledWith(path, file, {
      contentType: "application/pdf",
      upsert: false,
    });
    await expect(
      uploadFinanceProof(PROJECT, new File(["fake"], "receipt.html", { type: "application/pdf" })),
    ).rejects.toThrow("matching file extension");
    await expect(
      uploadFinanceProof(
        PROJECT,
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], "receipt.pdf", { type: "application/pdf" }),
      ),
    ).rejects.toThrow("5 MB");
    expect(upload).toHaveBeenCalledOnce();
  });
  it("opens a short-lived signed URL and closes the blank window on failure", async () => {
    const popup = { opener: {}, location: { href: "about:blank" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    await openFinanceProof(PROJECT, PROOF);
    expect(createSignedUrl).toHaveBeenCalledWith(PROOF, 300);
    expect(popup.opener).toBeNull();
    expect(popup.location.href).toBe("https://example.test/private-proof");
    createSignedUrl.mockResolvedValueOnce({ data: null, error: new Error("Access denied") });
    await expect(openFinanceProof(PROJECT, PROOF)).rejects.toThrow("Access denied");
    expect(popup.close).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
  it("does not request a signed URL when the browser blocks the popup", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    await expect(openFinanceProof(PROJECT, PROOF)).rejects.toThrow("Allow pop-ups");
    expect(createSignedUrl).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it("cleans only an explicitly discarded same-project draft and preserves retention errors", async () => {
    await expect(
      discardUnlinkedFinanceProof(PROJECT, PROOF.replace(PROJECT, OTHER_PROJECT)),
    ).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
    await discardUnlinkedFinanceProof(PROJECT, PROOF);
    expect(storageFrom).toHaveBeenCalledWith(FINANCE_PROOF_BUCKET);
    expect(remove).toHaveBeenCalledWith([PROOF]);
    remove.mockResolvedValueOnce({
      data: null,
      error: new Error("Referenced payment proofs must be retained"),
    });
    await expect(discardUnlinkedFinanceProof(PROJECT, PROOF)).rejects.toThrow("must be retained");
  });
});
