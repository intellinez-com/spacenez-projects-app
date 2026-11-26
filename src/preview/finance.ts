import { z } from "zod";
import type { FinanceAllocationInput, FinancePayment, ProjectFinanceBundle } from "@/lib/project-finance";
import type { Json } from "@/integrations/supabase/types";
import { previewIds } from "./fixtures";

/** Fictional amounts for the isolated usability preview; never written to Supabase. */
export function createPreviewFinance(): ProjectFinanceBundle {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const now = new Date().toISOString();
  const receiptId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
  const milestoneIds = [1, 2, 3, 4].map((n) => `eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee${n}`);
  return {
    access: "client",
    configured: true,
    plan: {
      project_id: previewIds.project,
      total_minor: 10_000_000,
      currency: "INR",
      quote_label: "Sample design agreement",
      scope_notes: "Fictional design-only quote for reviewing the payment experience.",
      payment_instructions: "Sample only. Do not send money using this preview.",
      version: 1,
      partner_summary_visible: false,
      created_by: previewIds.designer,
      updated_by: previewIds.designer,
      created_at: now,
      updated_at: now,
    },
    milestones: [
      {
        id: milestoneIds[0]!,
        project_id: previewIds.project,
        label: "Advance at signing",
        amount_minor: 3_000_000,
        due_date: date,
        due_condition: "At signing",
        position: 0,
        is_due: true,
        has_history: true,
        paid_minor: 3_000_000,
      },
      {
        id: milestoneIds[1]!,
        project_id: previewIds.project,
        label: "Layout approval",
        amount_minor: 2_500_000,
        due_date: date,
        due_condition: "After layout approval",
        position: 1,
        is_due: true,
        has_history: false,
        paid_minor: 0,
      },
      {
        id: milestoneIds[2]!,
        project_id: previewIds.project,
        label: "3D design approval",
        amount_minor: 2_500_000,
        due_date: null,
        due_condition: "After the 3D design is approved",
        position: 2,
        is_due: false,
        has_history: false,
        paid_minor: 0,
      },
      {
        id: milestoneIds[3]!,
        project_id: previewIds.project,
        label: "Final handover",
        amount_minor: 2_000_000,
        due_date: null,
        due_condition: "Before final drawings are handed over",
        position: 3,
        is_due: false,
        has_history: false,
        paid_minor: 0,
      },
    ],
    payments: [
      {
        id: receiptId,
        project_id: previewIds.project,
        kind: "receipt",
        purpose: "advance",
        amount_minor: 3_000_000,
        paid_on: date,
        method: "Bank transfer",
        reference: "SAMPLE-ADVANCE",
        notes: "Fictional advance already received.",
        proof_path: null,
        status: "confirmed",
        created_by: previewIds.designer,
        created_at: now,
        verified_by: previewIds.designer,
        verified_at: now,
        review_reason: "",
        related_payment_id: null,
      },
    ],
    allocations: [
      {
        payment_id: receiptId,
        milestone_id: milestoneIds[0]!,
        project_id: previewIds.project,
        amount_minor: 3_000_000,
      },
    ],
    summary: {
      received_minor: 3_000_000,
      refunded_minor: 0,
      net_received_minor: 3_000_000,
      pending_minor: 0,
      unallocated_minor: 0,
      outstanding_minor: 7_000_000,
      credit_minor: 0,
      due_now_minor: 2_500_000,
    },
    audit: [],
  };
}

// This small ledger belongs only to the serve-only demo transport. Database RPCs
// remain the authority in the real app; no gateway or persistence exists here.
const MAX = 1_000_000_000_000;
const amount = z.number().int().min(1).max(MAX);
const uuid = z.string().uuid();
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number(value.slice(0, 4)) > 0 && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const planInput = z.object({ total_minor: amount, currency: z.literal("INR"), quote_label: z.string().trim().max(200).default(""), scope_notes: z.string().trim().max(10000).default(""), payment_instructions: z.string().trim().max(5000).default(""), partner_summary_visible: z.boolean().default(false) }).strict();
const milestoneInput = z.object({ id: uuid, label: z.string().trim().min(1).max(200), amount_minor: amount, due_date: calendarDate.nullable().default(null), due_condition: z.string().trim().max(1000).default(""), position: z.number().int().min(0).max(10000).default(0), is_due: z.boolean().default(false) }).strict();
const paymentInput = z.object({ id: uuid, kind: z.enum(["receipt", "refund"]), purpose: z.enum(["advance", "payment", "other"]).default("payment"), amount_minor: amount, paid_on: calendarDate, method: z.string().trim().min(1).max(80), reference: z.string().trim().max(200).default(""), notes: z.string().trim().max(10000).default(""), proof_path: z.string().max(1000).nullable().default(null), related_payment_id: uuid.nullable().default(null) }).strict();
const allocationInput = z.array(z.object({ milestone_id: uuid, amount_minor: amount }).strict()).max(100);

export class PreviewFinanceError extends Error {
  constructor(message: string, readonly code = "22023") { super(message); }
}
function reject(message: string, code?: string): never { throw new PreviewFinanceError(message, code); }
function today() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function total(rows: { amount_minor: number }[]) { return rows.reduce((sum, row) => sum + row.amount_minor, 0); }

export function createPreviewFinanceSession(role: "client" | "admin", actorId: string, proofExists: (path: string) => boolean = () => false) {
  let state: ProjectFinanceBundle = role === "admin"
    ? { access: "admin", configured: false, plan: null, milestones: [], payments: [], allocations: [], summary: null, audit: [] }
    : createPreviewFinance();
  const requests = new Map<string, string>();
  const read = () => structuredClone(state);
  const requireAdmin = () => { if (role !== "admin") reject("This sample action is available only in the local admin preview.", "42501"); };
  const requirePlan = () => { if (!state.plan) reject("Configure the sample payment plan first.", "55000"); };
  function allocations(value: unknown): FinanceAllocationInput[] {
    const rows = allocationInput.parse(value ?? []);
    if (new Set(rows.map((row) => row.milestone_id)).size !== rows.length) reject("Choose each milestone only once.");
    if (rows.some((row) => !state.milestones.some((milestone) => milestone.id === row.milestone_id))) reject("The milestone does not belong to this sample project.");
    return rows.sort((a, b) => a.milestone_id.localeCompare(b.milestone_id));
  }
  function replaceAllocations(next: ProjectFinanceBundle, paymentId: string, rows: FinanceAllocationInput[]) {
    next.allocations = next.allocations.filter((row) => row.payment_id !== paymentId).concat(rows.map((row) => ({ ...row, project_id: previewIds.project, payment_id: paymentId })));
    for (const milestone of next.milestones) if (rows.some((row) => row.milestone_id === milestone.id)) milestone.has_history = true;
  }
  function validateAndCalculate(next: ProjectFinanceBundle) {
    if (!next.plan) reject("Configure the sample payment plan first.");
    if (total(next.milestones) > next.plan.total_minor) reject("Milestones cannot exceed the agreed amount.");
    if (total(next.payments.filter((row) => row.kind === "receipt" && ["confirmed", "reported"].includes(row.status))) > MAX) reject("The sample receipts exceed the supported amount range.");
    for (const payment of next.payments) {
      if (total(next.allocations.filter((row) => row.payment_id === payment.id)) > payment.amount_minor) reject("Allocations cannot exceed the payment amount.");
      if (payment.kind === "refund" && payment.status === "confirmed") {
        const source = next.payments.find((row) => row.id === payment.related_payment_id);
        if (!source || source.kind !== "receipt" || source.status !== "confirmed" || payment.paid_on < source.paid_on) reject("Choose a confirmed original receipt and a valid refund date.");
      }
    }
    for (const receipt of next.payments.filter((row) => row.kind === "receipt")) {
      const refunds = next.payments.filter((row) => row.kind === "refund" && row.related_payment_id === receipt.id && row.status === "confirmed");
      if (total(refunds) > receipt.amount_minor) reject("Refunds cannot exceed the original receipt.");
      const originalAllocations = next.allocations.filter((row) => row.payment_id === receipt.id);
      const refundedAllocations = next.allocations.filter((row) => refunds.some((refund) => refund.id === row.payment_id));
      for (const milestone of next.milestones) {
        if (total(refundedAllocations.filter((row) => row.milestone_id === milestone.id)) > total(originalAllocations.filter((row) => row.milestone_id === milestone.id))) reject("Refund allocations cannot exceed the original milestone payment.");
      }
      if (total(refunds) - total(refundedAllocations) > receipt.amount_minor - total(originalAllocations)) reject("Choose the refunded milestones for the allocated portion of this receipt.");
    }
    for (const milestone of next.milestones) {
      milestone.paid_minor = next.allocations.filter((row) => row.milestone_id === milestone.id).reduce((sum, row) => {
        const payment = next.payments.find((payment) => payment.id === row.payment_id);
        return payment?.status === "confirmed" ? sum + (payment.kind === "receipt" ? row.amount_minor : -row.amount_minor) : sum;
      }, 0);
      if (milestone.paid_minor < 0 || milestone.paid_minor > milestone.amount_minor) reject("Confirmed milestone payments exceed its amount.");
    }
    const confirmed = next.payments.filter((row) => row.status === "confirmed");
    const received = total(confirmed.filter((row) => row.kind === "receipt"));
    const refunded = total(confirmed.filter((row) => row.kind === "refund"));
    const net = received - refunded;
    const unallocated = net - next.milestones.reduce((sum, row) => sum + row.paid_minor, 0);
    const due = next.milestones.filter((row) => row.is_due || !!row.due_date && row.due_date <= today()).reduce((sum, row) => sum + row.amount_minor - row.paid_minor, 0);
    next.summary = { received_minor: received, refunded_minor: refunded, net_received_minor: net, pending_minor: total(next.payments.filter((row) => row.status === "reported")), unallocated_minor: unallocated, outstanding_minor: Math.max(next.plan.total_minor - net, 0), credit_minor: Math.max(net - next.plan.total_minor, 0), due_now_minor: Math.max(due - unallocated, 0) };
  }
  function commit(next: ProjectFinanceBundle, action: string, entityType: string, entityId: string, before: Json, after: Json) {
    validateAndCalculate(next);
    if (role === "admin") next.audit.unshift({ id: crypto.randomUUID(), project_id: previewIds.project, actor_id: actorId, action, entity_type: entityType, entity_id: entityId, created_at: new Date().toISOString(), details: { before, after } });
    state = next;
    return read();
  }
  return {
    read,
    save(expectedVersion: unknown, rawPlan: unknown, rawMilestones: unknown) {
      requireAdmin();
      const plan = planInput.parse(rawPlan), milestones = z.array(milestoneInput).max(100).parse(rawMilestones);
      if (expectedVersion !== (state.plan?.version ?? 0)) reject("The payment plan changed. Reload it before saving.", "40001");
      if (new Set(milestones.map((row) => row.id)).size !== milestones.length) reject("Each milestone needs a unique ID.");
      if (state.milestones.some((row) => row.has_history && !milestones.some((draft) => draft.id === row.id))) reject("A milestone with payment history cannot be removed.");
      const next = read(), now = new Date().toISOString();
      next.configured = true;
      next.plan = { ...plan, project_id: previewIds.project, version: (state.plan?.version ?? 0) + 1, created_by: state.plan?.created_by ?? actorId, created_at: state.plan?.created_at ?? now, updated_by: actorId, updated_at: now };
      next.milestones = milestones.map((row) => ({ ...row, project_id: previewIds.project, has_history: state.milestones.find((old) => old.id === row.id)?.has_history ?? false, paid_minor: 0 })).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
      return commit(next, state.plan ? "update" : "insert", "project_finance", previewIds.project, state.plan as Json, next.plan as Json);
    },
    record(rawPayment: unknown, rawAllocations: unknown = []) {
      requirePlan();
      const input = paymentInput.parse(rawPayment), rows = allocations(rawAllocations);
      if (role !== "admin" && (input.kind !== "receipt" || rows.length)) reject("Clients can report a payment for the team to confirm.", "42501");
      if (input.paid_on > today()) reject("Choose the actual payment date up to today.");
      if ((input.kind === "refund") !== (input.related_payment_id !== null)) reject("A refund must refer to its original receipt.");
      const canonical = JSON.stringify({ ...input, created_by: actorId, allocations: rows });
      if (state.payments.some((row) => row.id === input.id)) {
        if (requests.get(input.id) === canonical) return read();
        reject("This sample payment may already be saved with different details. Check payment history.", "23505");
      }
      if (input.proof_path !== null && (!input.proof_path.startsWith(`${previewIds.project}/`) || (role !== "admin" && !input.proof_path.startsWith(`${previewIds.project}/${actorId}/`)) || !proofExists(input.proof_path))) reject("Choose an uploaded proof from this sample project.");
      const now = new Date().toISOString(), next = read();
      const payment: FinancePayment = { ...input, project_id: previewIds.project, status: role === "admin" ? "confirmed" : "reported", created_by: actorId, created_at: now, verified_by: role === "admin" ? actorId : null, verified_at: role === "admin" ? now : null, review_reason: "" };
      next.payments.unshift(payment);
      replaceAllocations(next, payment.id, rows);
      const result = commit(next, "insert", "project_payments", payment.id, null, payment as Json);
      requests.set(payment.id, canonical);
      return result;
    },
    review(paymentId: unknown, decision: unknown, rawReason: unknown, rawAllocations: unknown = null) {
      requireAdmin(); requirePlan();
      const id = uuid.parse(paymentId), action = z.enum(["confirm", "reject", "void"]).parse(decision), reason = z.string().trim().max(1000).parse(rawReason ?? "");
      if (action !== "confirm" && !reason) reject("Enter a reason for the change.");
      const current = state.payments.find((row) => row.id === id);
      if (!current) reject("Sample payment not found.");
      const target = action === "confirm" ? "confirmed" : action === "reject" ? "rejected" : "voided";
      const rows = rawAllocations === null ? state.allocations.filter((row) => row.payment_id === id).map(({ milestone_id, amount_minor }) => ({ milestone_id, amount_minor })).sort((a, b) => a.milestone_id.localeCompare(b.milestone_id)) : allocations(rawAllocations);
      const existing = state.allocations.filter((row) => row.payment_id === id).map(({ milestone_id, amount_minor }) => ({ milestone_id, amount_minor })).sort((a, b) => a.milestone_id.localeCompare(b.milestone_id));
      if (current.status === target) {
        if (current.review_reason === reason && JSON.stringify(rows) === JSON.stringify(existing)) return read();
        reject("This sample payment was already reviewed with different details.");
      }
      if (action !== "void" && (current.status !== "reported" || current.kind !== "receipt") || action === "void" && !["reported", "confirmed"].includes(current.status)) reject("This sample payment has already changed.");
      if (action === "void" && current.kind === "receipt" && state.payments.some((row) => row.related_payment_id === id && row.status === "confirmed")) reject("Void linked refunds before voiding their receipt.");
      if (action !== "confirm" && JSON.stringify(rows) !== JSON.stringify(existing)) reject("Allocations can change while confirming, not while rejecting or voiding.");
      const next = read(), changed = next.payments.find((row) => row.id === id)!;
      Object.assign(changed, { status: target, verified_by: actorId, verified_at: new Date().toISOString(), review_reason: reason });
      if (action === "confirm") replaceAllocations(next, id, rows);
      return commit(next, "update", "project_payments", id, current as Json, changed as Json);
    },
    allocate(paymentId: unknown, rawAllocations: unknown) {
      requireAdmin(); requirePlan();
      const id = uuid.parse(paymentId), current = state.payments.find((row) => row.id === id);
      if (!current || current.kind !== "receipt" || current.status !== "confirmed") reject("Choose a confirmed sample receipt.");
      const rows = allocations(rawAllocations);
      const existing = state.allocations.filter((row) => row.payment_id === id).map(({ milestone_id, amount_minor }) => ({ milestone_id, amount_minor })).sort((a, b) => a.milestone_id.localeCompare(b.milestone_id));
      if (JSON.stringify(existing) === JSON.stringify(rows)) return read();
      if (state.payments.some((row) => row.related_payment_id === id && row.status === "confirmed")) reject("Void linked refunds before changing this receipt allocation.");
      const next = read(); replaceAllocations(next, id, rows);
      return commit(next, "update", "project_payment_allocations", id, existing, rows);
    },
  };
}
