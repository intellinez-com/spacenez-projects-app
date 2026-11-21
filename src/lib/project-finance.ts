import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

export const FINANCE_MAX_MINOR = 1_000_000_000_000;
export const FINANCE_PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const FINANCE_PROOF_BUCKET = "project-finance";

const uuid = z.string().uuid();
const minor = z.number().int().min(0).max(FINANCE_MAX_MINOR);
const positiveMinor = minor.min(1);
const timestamp = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), "Invalid timestamp");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a valid calendar date");
const json: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(json), z.record(json)]),
);

const planInputSchema = z
  .object({
    total_minor: positiveMinor,
    currency: z.literal("INR"),
    quote_label: z.string(),
    scope_notes: z.string(),
    payment_instructions: z.string(),
    partner_summary_visible: z.boolean(),
  })
  .strict();

const planSchema = z
  .object({
    project_id: uuid,
    total_minor: positiveMinor,
    currency: z.literal("INR"),
    quote_label: z.string(),
    version: z.number().int().min(1),
    partner_summary_visible: z.boolean(),
    scope_notes: z.string().optional(),
    payment_instructions: z.string().optional(),
    created_by: uuid.nullable().optional(),
    created_at: timestamp.optional(),
    updated_by: uuid.nullable().optional(),
    updated_at: timestamp.optional(),
  })
  .strict();

const milestoneInputSchema = z
  .object({
    id: uuid,
    label: z.string().trim().min(1),
    amount_minor: positiveMinor,
    due_date: date.nullable(),
    due_condition: z.string(),
    position: z.number().int().min(0),
    is_due: z.boolean(),
  })
  .strict();
const milestoneSchema = milestoneInputSchema.extend({
  project_id: uuid,
  has_history: z.boolean(),
  paid_minor: minor,
});
const paymentInputSchema = z
  .object({
    id: uuid,
    kind: z.enum(["receipt", "refund"]),
    purpose: z.enum(["advance", "payment", "other"]),
    amount_minor: positiveMinor,
    paid_on: date,
    method: z.string().trim().min(1).max(80),
    reference: z.string(),
    notes: z.string(),
    proof_path: z.string().nullable(),
    related_payment_id: uuid.nullable(),
  })
  .strict();
const paymentSchema = paymentInputSchema.extend({
  project_id: uuid,
  status: z.enum(["reported", "confirmed", "rejected", "voided"]),
  created_by: uuid.nullable(),
  created_at: timestamp,
  verified_by: uuid.nullable(),
  verified_at: timestamp.nullable(),
  review_reason: z.string(),
});
const allocationInputSchema = z
  .object({ milestone_id: uuid, amount_minor: positiveMinor })
  .strict();
const allocationSchema = allocationInputSchema.extend({ payment_id: uuid, project_id: uuid });
const auditSchema = z
  .object({
    id: uuid,
    project_id: uuid,
    actor_id: uuid.nullable(),
    action: z.string(),
    entity_type: z.string(),
    entity_id: uuid.nullable(),
    created_at: timestamp,
    details: json,
  })
  .strict();
const summarySchema = z
  .object({
    received_minor: minor,
    refunded_minor: minor,
    net_received_minor: minor,
    pending_minor: minor,
    unallocated_minor: minor,
    outstanding_minor: minor,
    credit_minor: minor,
    due_now_minor: minor,
  })
  .strict();
const bundleSchema = z
  .object({
    access: z.enum(["admin", "client", "partner", "restricted"]),
    configured: z.boolean(),
    plan: planSchema.nullable(),
    milestones: z.array(milestoneSchema),
    payments: z.array(paymentSchema),
    allocations: z.array(allocationSchema),
    summary: summarySchema.nullable(),
    audit: z.array(auditSchema),
  })
  .strict();

export type FinancePlanInput = z.infer<typeof planInputSchema>;
export type FinanceMilestoneInput = z.infer<typeof milestoneInputSchema>;
export type FinancePaymentInput = z.infer<typeof paymentInputSchema>;
export type FinanceAllocationInput = z.infer<typeof allocationInputSchema>;
export type FinancePlan = z.infer<typeof planSchema>;
export type FinanceMilestone = z.infer<typeof milestoneSchema>;
export type FinancePayment = z.infer<typeof paymentSchema>;
export type FinanceAllocation = z.infer<typeof allocationSchema>;
export type FinanceAudit = z.infer<typeof auditSchema>;
export type FinanceSummary = z.infer<typeof summarySchema>;
export type FinanceBundle = z.infer<typeof bundleSchema>;
export type ProjectFinanceBundle = FinanceBundle;

export function financeQueryKey(projectId: string) {
  return ["project-finance", projectId] as const;
}

/** Convert decimal rupees to integer paise without floating-point rounding. */
export function parseMoneyToPaise(input: string): number {
  const value = input.trim();
  if (value.length > 32) throw new Error("Amount is too large.");
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("Enter an amount in rupees with up to two decimal places.");
  }
  const [whole = "0", fraction = ""] = value.split(".");
  // Bound the string before BigInt parsing to keep accidental giant input cheap.
  if (whole.replace(/^0+/, "").length > 11) throw new Error("Amount is too large.");
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (result > BigInt(FINANCE_MAX_MINOR)) throw new Error("Amount is too large.");
  return Number(result);
}

function assertDisplayAmount(value: number): void {
  if (!Number.isSafeInteger(value) || Math.abs(value) > FINANCE_MAX_MINOR) {
    throw new Error("Invalid amount in paise.");
  }
}

export function formatMoneyInput(paise: number): string {
  assertDisplayAmount(paise);
  const amount = Math.abs(paise);
  return `${paise < 0 ? "-" : ""}${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;
}

export function formatMoney(paise: number): string {
  assertDisplayAmount(paise);
  const amount = Math.abs(paise);
  const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(
    Math.floor(amount / 100),
  );
  return `${paise < 0 ? "-" : ""}₹${rupees}.${String(amount % 100).padStart(2, "0")}`;
}

/** Validate the RPC contract and project scope before putting data in the cache. */
export function parseProjectFinanceBundle(value: unknown, projectId?: string): FinanceBundle {
  const parsed = bundleSchema.safeParse(value);
  if (!parsed.success)
    throw new Error("The payment details could not be read. Refresh and try again.");
  const result = parsed.data;
  const invalid = () => {
    throw new Error("The payment details could not be read safely. Refresh and try again.");
  };
  if (projectId !== undefined) {
    uuid.parse(projectId);
    if (result.plan && result.plan.project_id !== projectId) invalid();
    if (
      [...result.milestones, ...result.payments, ...result.allocations, ...result.audit].some(
        (row) => row.project_id !== projectId,
      )
    )
      invalid();
  }
  if (result.access === "restricted" || !result.configured) {
    if (
      result.plan ||
      result.summary ||
      result.milestones.length ||
      result.payments.length ||
      result.allocations.length ||
      result.audit.length
    )
      invalid();
    return result;
  }
  if (!result.plan || !result.summary) return invalid();
  if (result.access === "partner") {
    if (
      !result.plan.partner_summary_visible ||
      result.payments.length ||
      result.allocations.length ||
      result.audit.length
    )
      invalid();
    if (
      [
        "scope_notes",
        "payment_instructions",
        "created_by",
        "created_at",
        "updated_by",
        "updated_at",
      ].some((key) => Object.hasOwn(result.plan!, key))
    )
      invalid();
  } else {
    if (result.plan.scope_notes === undefined || result.plan.payment_instructions === undefined)
      invalid();
    if (result.access === "client" && result.audit.length) invalid();
  }
  const resolvedProject = projectId ?? result.plan.project_id;
  if (
    result.plan.project_id !== resolvedProject ||
    [...result.milestones, ...result.payments, ...result.allocations, ...result.audit].some(
      (row) => row.project_id !== resolvedProject,
    )
  )
    invalid();
  for (const payment of result.payments) {
    if (payment.proof_path !== null) assertFinanceProofPath(resolvedProject, payment.proof_path);
    if (payment.kind === "refund" && payment.related_payment_id === null) invalid();
    if (payment.kind === "receipt" && payment.related_payment_id !== null) invalid();
  }
  const milestoneIds = new Set(result.milestones.map((item) => item.id));
  const paymentIds = new Set(result.payments.map((item) => item.id));
  if (milestoneIds.size !== result.milestones.length || paymentIds.size !== result.payments.length)
    invalid();
  if (
    result.allocations.some(
      (item) => !milestoneIds.has(item.milestone_id) || !paymentIds.has(item.payment_id),
    )
  )
    invalid();
  return result;
}

function rpcError(error: { message: string; code?: string }, operation: FinanceRpc): Error {
  if (operation === "record_project_payment" && error.code === "23505") {
    return new Error(
      "This payment may already be saved with different details. Refresh payments and check history.",
    );
  }
  if (error.code === "PGRST202" || error.code === "42883") {
    return new Error(
      "Payments are not available yet. Please ask the team to finish the database update.",
    );
  }
  return new Error(error.message || "The payment change could not be saved. Please try again.");
}

type Functions = Database["public"]["Functions"];
type FinanceRpc =
  | "get_project_finance"
  | "save_project_finance"
  | "record_project_payment"
  | "review_project_payment"
  | "allocate_project_payment";

async function callFinanceRpc<Name extends FinanceRpc>(
  name: Name,
  args: Functions[Name]["Args"],
  projectId?: string,
): Promise<FinanceBundle> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw rpcError(error, name);
  return parseProjectFinanceBundle(data, projectId);
}

export async function loadProjectFinance(projectId: string): Promise<FinanceBundle> {
  return callFinanceRpc("get_project_finance", { p_project_id: uuid.parse(projectId) }, projectId);
}

export async function saveProjectFinance(
  projectId: string,
  expectedVersion: number,
  plan: FinancePlanInput,
  milestones: FinanceMilestoneInput[],
): Promise<FinanceBundle> {
  const input = planInputSchema.parse(plan);
  const rows = z.array(milestoneInputSchema).parse(milestones);
  const version = z.number().int().min(0).parse(expectedVersion);
  if (new Set(rows.map((item) => item.id)).size !== rows.length)
    throw new Error("Each milestone must have a different ID.");
  if (rows.reduce((total, item) => total + item.amount_minor, 0) > input.total_minor)
    throw new Error("Milestone amounts cannot exceed the agreed total.");
  return callFinanceRpc(
    "save_project_finance",
    {
      p_project_id: uuid.parse(projectId),
      p_expected_version: version,
      p_plan: input,
      p_milestones: rows,
    },
    projectId,
  );
}

export async function recordProjectPayment(
  projectId: string,
  payment: FinancePaymentInput,
  allocations: FinanceAllocationInput[] = [],
): Promise<FinanceBundle> {
  const input = paymentInputSchema.parse(payment);
  uuid.parse(projectId);
  if (input.proof_path !== null) assertFinanceProofPath(projectId, input.proof_path);
  if ((input.kind === "refund") !== (input.related_payment_id !== null))
    throw new Error("A refund must refer to its original receipt.");
  const rows = parseAllocations(allocations);
  if (rows.reduce((total, row) => total + row.amount_minor, 0) > input.amount_minor)
    throw new Error("Allocations cannot exceed the payment amount.");
  return callFinanceRpc(
    "record_project_payment",
    { p_project_id: projectId, p_payment: input, p_allocations: rows },
    projectId,
  );
}

function parseAllocations(value: FinanceAllocationInput[]): FinanceAllocationInput[] {
  const parsed = z.array(allocationInputSchema).parse(value);
  if (new Set(parsed.map((item) => item.milestone_id)).size !== parsed.length)
    throw new Error("Allocate to each milestone only once.");
  return parsed;
}

export async function reviewProjectPayment(
  paymentId: string,
  decision: "confirm" | "reject" | "void",
  reason: string,
  allocations?: FinanceAllocationInput[],
): Promise<FinanceBundle> {
  const args: Functions["review_project_payment"]["Args"] = {
    p_payment_id: uuid.parse(paymentId),
    p_decision: z.enum(["confirm", "reject", "void"]).parse(decision),
    p_reason: reason,
  };
  if (allocations !== undefined) args.p_allocations = parseAllocations(allocations);
  return callFinanceRpc("review_project_payment", args);
}

export async function allocateProjectPayment(
  paymentId: string,
  allocations: FinanceAllocationInput[],
): Promise<FinanceBundle> {
  return callFinanceRpc("allocate_project_payment", {
    p_payment_id: uuid.parse(paymentId),
    p_allocations: parseAllocations(allocations),
  });
}

/** Keep one ID for the whole draft: edits after a lost response must not insert a second payment. */
export function createFinanceRetryIdentity() {
  let id: string | undefined;
  return {
    forPayload(payload: unknown): string {
      json.parse(payload);
      id ??= crypto.randomUUID();
      return id;
    },
    reset(): void {
      id = undefined;
    },
  };
}

export function assertFinanceProofPath(projectId: string, path: string): void {
  uuid.parse(projectId);
  const parts = path.split("/");
  if (
    parts.length !== 3 ||
    parts[0] !== projectId ||
    !uuid.safeParse(parts[1]).success ||
    !/^[0-9a-f-]{36}-[A-Za-z0-9_.-]+\.(pdf|png|jpe?g|webp)$/i.test(parts[2] ?? "") ||
    !uuid.safeParse(parts[2]?.slice(0, 36)).success
  ) {
    throw new Error("This payment proof does not belong to the selected project.");
  }
}

const proofTypes: Record<string, readonly string[]> = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
};

export async function uploadFinanceProof(projectId: string, file: File): Promise<string> {
  uuid.parse(projectId);
  if (file.size === 0 || file.size > FINANCE_PROOF_MAX_BYTES)
    throw new Error("Choose a payment proof smaller than 5 MB.");
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!proofTypes[file.type]?.includes(extension))
    throw new Error(
      "Choose a PDF, PNG, JPEG or WebP payment proof with its matching file extension.",
    );
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Please sign in again before uploading a payment proof.");
  const owner = uuid.parse(data.user.id);
  const filename = file.name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(-150);
  const path = `${projectId}/${owner}/${crypto.randomUUID()}-${filename}`;
  assertFinanceProofPath(projectId, path);
  const uploaded = await supabase.storage
    .from(FINANCE_PROOF_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploaded.error) throw uploaded.error;
  return path;
}

/** Explicit draft cleanup only. Keep proofs after an uncertain save so the same command can be retried. */
export async function discardUnlinkedFinanceProof(projectId: string, path: string): Promise<void> {
  assertFinanceProofPath(projectId, path);
  const { error } = await supabase.storage.from(FINANCE_PROOF_BUCKET).remove([path]);
  if (error) throw error;
}

/** Open synchronously to preserve the user's click on mobile, then resolve a short-lived signed URL. */
export async function openFinanceProof(projectId: string, path: string): Promise<void> {
  assertFinanceProofPath(projectId, path);
  const popup = window.open("about:blank", "_blank");
  if (!popup) throw new Error("Allow pop-ups to open the payment proof.");
  popup.opener = null;
  try {
    const { data, error } = await supabase.storage
      .from(FINANCE_PROOF_BUCKET)
      .createSignedUrl(path, 300);
    if (error) throw error;
    if (!data?.signedUrl || !/^https?:\/\//i.test(data.signedUrl))
      throw new Error("The payment proof could not be opened.");
    popup.location.href = data.signedUrl;
  } catch (error) {
    popup.close();
    throw error;
  }
}
