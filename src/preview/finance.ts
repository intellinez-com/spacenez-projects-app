import type { ProjectFinanceBundle } from "@/lib/project-finance";
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
