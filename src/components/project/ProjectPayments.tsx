import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isValid, parseISO } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/errors";
import { projectDay } from "@/lib/daily-updates";
import {
  allocateProjectPayment,
  createFinanceRetryIdentity,
  discardUnlinkedFinanceProof,
  financeQueryKey,
  formatMoney,
  formatMoneyInput,
  loadProjectFinance,
  openFinanceProof,
  parseMoneyToPaise,
  recordProjectPayment,
  reviewProjectPayment,
  saveProjectFinance,
  uploadFinanceProof,
  type FinanceAllocationInput,
  type FinanceAudit,
  type FinanceBundle,
  type FinanceMilestoneInput,
  type FinancePayment,
  type FinancePaymentInput,
  type FinancePlanInput,
} from "@/lib/project-finance";

type Panel =
  | "plan"
  | "receipt"
  | "report"
  | "refund"
  | { type: "review"; id: string; decision: "confirm" | "reject" | "void" }
  | { type: "allocate"; id: string }
  | null;
type FormProps = {
  projectId: string;
  finance: FinanceBundle;
  onSaved: (value: FinanceBundle, message: string) => void;
  onCancel: () => void;
};
const inputClass = "h-11 w-full min-w-0 rounded-md border bg-background px-3 text-base md:text-sm";
const statusLabels = {
  reported: "Awaiting confirmation",
  confirmed: "Confirmed",
  rejected: "Rejected",
  voided: "Voided",
};

function dateLabel(value: string) {
  const date = parseISO(value);
  return isValid(date) ? format(date, "d MMM yyyy") : "Date unavailable";
}
function positive(value: string) {
  const minor = parseMoneyToPaise(value);
  if (minor <= 0) throw new Error("Enter an amount greater than zero.");
  return minor;
}
function safeAmount(value: string) {
  try {
    return parseMoneyToPaise(value);
  } catch {
    return null;
  }
}
function receiptName(payment: FinancePayment) {
  const kind =
    payment.kind === "refund"
      ? "Refund"
      : payment.purpose === "advance"
        ? "Advance / token"
        : "Payment";
  return `${kind} · ${dateLabel(payment.paid_on)} · ${formatMoney(payment.amount_minor)}`;
}
function auditObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function auditLabel(entry: FinanceAudit) {
  const details = auditObject(entry.details);
  const before = auditObject(details["before"]);
  const after = auditObject(details["after"]);
  const beforeTotal = before["total_minor"],
    afterTotal = after["total_minor"];
  const beforeStatus = before["status"],
    afterStatus = after["status"];
  const entity =
    entry.entity_type === "project_finance"
      ? "Payment plan"
      : entry.entity_type === "project_payment_milestones"
        ? "Milestone"
        : entry.entity_type === "project_payment_allocations"
          ? "Milestone allocation"
          : after["kind"] === "refund" || before["kind"] === "refund"
            ? "Refund"
            : "Payment";
  const action =
    entry.action === "insert" ? "added" : entry.action === "delete" ? "removed" : "updated";
  if (
    entry.entity_type === "project_finance" &&
    typeof beforeTotal === "number" &&
    typeof afterTotal === "number" &&
    beforeTotal !== afterTotal
  )
    return `${entity} total changed: ${formatMoney(beforeTotal)} → ${formatMoney(afterTotal)}`;
  if (
    typeof beforeStatus === "string" &&
    typeof afterStatus === "string" &&
    beforeStatus !== afterStatus &&
    beforeStatus in statusLabels &&
    afterStatus in statusLabels
  )
    return `${entity}: ${statusLabels[beforeStatus as keyof typeof statusLabels]} → ${statusLabels[afterStatus as keyof typeof statusLabels]}`;
  return `${entity} ${action}`;
}
function refundBalance(finance: FinanceBundle, payment: FinancePayment) {
  return (
    payment.amount_minor -
    finance.payments
      .filter(
        (row) =>
          row.kind === "refund" &&
          row.status === "confirmed" &&
          row.related_payment_id === payment.id,
      )
      .reduce((sum, row) => sum + row.amount_minor, 0)
  );
}
function allocationValues(finance: FinanceBundle, paymentId: string) {
  return Object.fromEntries(
    finance.allocations
      .filter((row) => row.payment_id === paymentId)
      .map((row) => [row.milestone_id, formatMoneyInput(row.amount_minor)]),
  );
}
function allocationInput(values: Record<string, string>): FinanceAllocationInput[] {
  return Object.entries(values).flatMap(([milestone_id, amount]) => {
    if (!amount.trim()) return [];
    const amount_minor = parseMoneyToPaise(amount);
    return amount_minor > 0 ? [{ milestone_id, amount_minor }] : [];
  });
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
function FormError({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
      {message}
    </p>
  ) : null;
}

export function ProjectPayments({ projectId }: { projectId: string }) {
  return <PaymentsContent key={projectId} projectId={projectId} />;
}

function PaymentsContent({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: financeQueryKey(projectId),
    queryFn: () => loadProjectFinance(projectId),
    refetchInterval: 60_000,
  });
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState("");
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!panel || !editor.current) return;
    editor.current.scrollIntoView?.({ behavior: "smooth", block: "start" });
    editor.current.focus({ preventScroll: true });
  }, [panel]);
  const finance = query.data;
  function saved(value: FinanceBundle, message: string) {
    qc.setQueryData(financeQueryKey(projectId), value);
    void qc.invalidateQueries({ queryKey: financeQueryKey(projectId) }).catch(() => undefined);
    setPanel(null);
    setNotice(message);
  }
  if (!finance && query.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading payments…
      </p>
    );
  if (!finance)
    return (
      <div role="alert" className="space-y-3 text-sm">
        <p>Payment details could not be loaded. {errorMessage(query.error, "Please try again.")}</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Retry payments
        </Button>
      </div>
    );
  if (finance.access === "restricted")
    return (
      <section className="space-y-3">
        <h2 className="text-xl">Payments</h2>
        <p className="text-sm text-muted-foreground">
          Payment details have not been shared with your account.
        </p>
      </section>
    );
  const admin = finance.access === "admin";
  const fullAccess = admin || finance.access === "client";
  const plan = finance.plan,
    summary = finance.summary;
  const refundable = finance.payments.filter(
    (row) =>
      row.kind === "receipt" && row.status === "confirmed" && refundBalance(finance, row) > 0,
  );
  const formProps: FormProps = {
    projectId,
    finance,
    onSaved: saved,
    onCancel: () => setPanel(null),
  };
  const advanceIds = new Set(
    finance.payments
      .filter(
        (row) => row.kind === "receipt" && row.status === "confirmed" && row.purpose === "advance",
      )
      .map((row) => row.id),
  );
  const advances = finance.payments.reduce(
    (sum, row) =>
      row.status !== "confirmed"
        ? sum
        : row.kind === "receipt" && advanceIds.has(row.id)
          ? sum + row.amount_minor
          : row.kind === "refund" &&
              row.related_payment_id &&
              advanceIds.has(row.related_payment_id)
            ? sum - row.amount_minor
            : sum,
    0,
  );
  return (
    <div className="min-w-0 space-y-6 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl">Payments</h2>
        {!panel && (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {admin ? (
              <>
                <Button
                  className="min-h-11 flex-1 sm:flex-none"
                  onClick={() => {
                    setNotice("");
                    setPanel("plan");
                  }}
                >
                  {finance.configured ? "Edit payment plan" : "Set up payment plan"}
                </Button>
                {finance.configured && (
                  <Button
                    variant="outline"
                    className="min-h-11 flex-1 sm:flex-none"
                    onClick={() => {
                      setNotice("");
                      setPanel("receipt");
                    }}
                  >
                    Record received payment
                  </Button>
                )}
                {refundable.length > 0 && (
                  <Button
                    variant="outline"
                    className="min-h-11 flex-1 sm:flex-none"
                    onClick={() => {
                      setNotice("");
                      setPanel("refund");
                    }}
                  >
                    Record returned refund
                  </Button>
                )}
              </>
            ) : (
              finance.access === "client" &&
              finance.configured && (
                <Button
                  className="min-h-11 w-full sm:w-auto"
                  onClick={() => {
                    setNotice("");
                    setPanel("report");
                  }}
                >
                  Report a payment
                </Button>
              )
            )}
          </div>
        )}
      </div>
      {query.isError && (
        <div role="alert" className="space-y-2 text-sm">
          <p>Payment details could not be refreshed. Showing the last loaded information.</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry payments
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {panel && (
        <div
          ref={editor}
          tabIndex={-1}
          role="region"
          aria-label="Payment editor"
          className="scroll-mt-24 outline-none"
        >
          {panel === "plan" && admin && <PlanForm {...formProps} />}
          {(panel === "receipt" || panel === "report" || panel === "refund") &&
            finance.configured && <PaymentForm {...formProps} mode={panel} />}
          {panel && typeof panel === "object" && panel.type === "review" && admin && (
            <ReviewForm
              key={`${panel.id}:${panel.decision}`}
              {...formProps}
              paymentId={panel.id}
              decision={panel.decision}
            />
          )}
          {panel && typeof panel === "object" && panel.type === "allocate" && admin && (
            <AllocateForm key={panel.id} {...formProps} paymentId={panel.id} />
          )}
        </div>
      )}
      {!finance.configured ? (
        <div className="space-y-2 rounded-lg border p-4 text-sm">
          <p className="font-medium">The agreed payment plan has not been added yet.</p>
          <p className="text-muted-foreground">
            {admin
              ? "Enter the actual agreed project amount and payment schedule before recording the token or other payments."
              : "Spacenez will share the agreed amount, payment schedule and confirmed payments here."}
          </p>
        </div>
      ) : plan && summary ? (
        <>
          <section
            className="space-y-4 rounded-lg border bg-card p-4 sm:p-5"
            aria-label="Payment summary"
          >
            {plan.quote_label && <h3 className="text-lg">{plan.quote_label}</h3>}
            <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm lg:grid-cols-4">
              {[
                ["Agreed total", plan.total_minor],
                ["Confirmed paid", summary.net_received_minor],
                ["Due now", summary.due_now_minor],
                ["Remaining balance", summary.outstanding_minor],
              ].map(([label, amount]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-lg tabular-nums [overflow-wrap:anywhere]">
                    {formatMoney(amount as number)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-muted-foreground">
              Remaining balance includes amounts due now and later milestones. Pending reports do
              not count as paid.
            </p>
            {fullAccess && advances > 0 && (
              <p className="text-sm text-muted-foreground">
                Confirmed advance / token included in paid amount: {formatMoney(advances)}
              </p>
            )}
            {summary.pending_minor > 0 && fullAccess && (
              <p className="text-sm">
                Reported, awaiting confirmation:{" "}
                <strong>{formatMoney(summary.pending_minor)}</strong>. This is not included in
                confirmed paid.
              </p>
            )}
            {summary.refunded_minor > 0 && (
              <p className="text-sm">
                Recorded refunds: {formatMoney(summary.refunded_minor)}. Confirmed paid is after
                these refunds.
              </p>
            )}
            {summary.unallocated_minor > 0 && (
              <p className="text-sm text-muted-foreground">
                Confirmed funds not assigned to a milestone:{" "}
                {formatMoney(summary.unallocated_minor)}. These funds already reduce the due now
                amount. Milestone balances below show only the funds assigned to each milestone.
              </p>
            )}
            {summary.credit_minor > 0 && (
              <p className="text-sm">
                Credit / overpayment: <strong>{formatMoney(summary.credit_minor)}</strong>
              </p>
            )}
            {fullAccess && plan.scope_notes && (
              <div className="space-y-1 text-sm">
                <h4 className="font-medium">Agreed scope</h4>
                <p className="whitespace-pre-wrap">{plan.scope_notes}</p>
              </div>
            )}
            {fullAccess && plan.payment_instructions && (
              <div className="space-y-1 border-t pt-3 text-sm">
                <h4 className="font-medium">Payment instructions</h4>
                <p className="whitespace-pre-wrap">{plan.payment_instructions}</p>
              </div>
            )}
            {finance.access === "partner" && (
              <p className="text-sm text-muted-foreground">
                Spacenez has shared the payment summary and milestones with your account.
              </p>
            )}
          </section>
          <section className="space-y-3" aria-labelledby={`payment-milestones-${projectId}`}>
            <h3 id={`payment-milestones-${projectId}`} className="text-lg">
              Payment milestones
            </h3>
            {finance.milestones.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                A milestone schedule has not been added yet.
              </p>
            ) : (
              <ol className="grid min-w-0 gap-3 lg:grid-cols-2">
                {finance.milestones.map((milestone) => {
                  const remaining = Math.max(0, milestone.amount_minor - milestone.paid_minor);
                  const due =
                    remaining > 0 &&
                    (milestone.is_due ||
                      (!!milestone.due_date && milestone.due_date <= projectDay()));
                  return (
                    <li key={milestone.id} className="min-w-0 space-y-2 rounded-lg border p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h4 className="text-sm font-medium">{milestone.label}</h4>
                        <span className="text-sm">
                          {remaining === 0 ? "Paid" : due ? "Due" : "Upcoming"}
                        </span>
                      </div>
                      <p className="text-lg tabular-nums">{formatMoney(milestone.amount_minor)}</p>
                      <p className="text-sm text-muted-foreground">
                        Confirmed: {formatMoney(milestone.paid_minor)} · Remaining:{" "}
                        {formatMoney(remaining)}
                      </p>
                      <p className="text-sm">
                        {milestone.due_date
                          ? `Due ${dateLabel(milestone.due_date)}`
                          : "Due date not set"}
                      </p>
                      {milestone.due_condition && (
                        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                          {milestone.due_condition}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
          {fullAccess && (
            <section className="space-y-3" aria-labelledby={`payment-history-${projectId}`}>
              <h3 id={`payment-history-${projectId}`} className="text-lg">
                Payment history
              </h3>
              {finance.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments have been recorded yet.</p>
              ) : (
                <ol className="min-w-0 divide-y rounded-lg border">
                  {finance.payments.map((payment) => (
                    <li key={payment.id} className="min-w-0 space-y-3 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-medium">
                            {payment.kind === "refund"
                              ? "Refund recorded"
                              : payment.purpose === "advance"
                                ? "Advance / token"
                                : "Payment"}
                          </h4>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {dateLabel(payment.paid_on)} · {payment.method}
                          </p>
                        </div>
                        <div className="space-y-1 text-right">
                          <p className="text-lg tabular-nums">
                            {formatMoney(payment.amount_minor)}
                          </p>
                          <p className="text-sm">{statusLabels[payment.status]}</p>
                        </div>
                      </div>
                      {payment.reference && (
                        <p className="text-sm">
                          Reference:{" "}
                          <span className="[overflow-wrap:anywhere]">{payment.reference}</span>
                        </p>
                      )}
                      {payment.notes && (
                        <p className="whitespace-pre-wrap text-sm">{payment.notes}</p>
                      )}
                      {payment.review_reason && (
                        <p className="text-sm">Review note: {payment.review_reason}</p>
                      )}
                      {finance.allocations.some((row) => row.payment_id === payment.id) && (
                        <ul className="space-y-1 text-sm text-muted-foreground">
                          {finance.allocations
                            .filter((row) => row.payment_id === payment.id)
                            .map((row) => (
                              <li key={row.milestone_id}>
                                {finance.milestones.find(
                                  (milestone) => milestone.id === row.milestone_id,
                                )?.label || "Milestone"}
                                : {formatMoney(row.amount_minor)}
                              </li>
                            ))}
                        </ul>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {payment.proof_path && (
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-11 whitespace-normal"
                            onClick={() =>
                              void openFinanceProof(projectId, payment.proof_path!).catch(
                                (failure) =>
                                  toast.error(
                                    errorMessage(failure, "Payment proof could not be opened."),
                                  ),
                              )
                            }
                          >
                            Open payment proof
                          </Button>
                        )}
                        {admin && !panel && payment.status === "reported" && (
                          <>
                            <Button
                              className="min-h-11"
                              onClick={() =>
                                setPanel({ type: "review", id: payment.id, decision: "confirm" })
                              }
                            >
                              Confirm payment
                            </Button>
                            <Button
                              variant="outline"
                              className="min-h-11"
                              onClick={() =>
                                setPanel({ type: "review", id: payment.id, decision: "reject" })
                              }
                            >
                              Reject report
                            </Button>
                          </>
                        )}
                        {admin && !panel && payment.status === "confirmed" && (
                          <>
                            {payment.kind === "receipt" &&
                              !finance.payments.some(
                                (row) =>
                                  row.kind === "refund" &&
                                  row.related_payment_id === payment.id &&
                                  row.status === "confirmed",
                              ) && (
                                <Button
                                  variant="outline"
                                  className="min-h-11"
                                  onClick={() => setPanel({ type: "allocate", id: payment.id })}
                                >
                                  Allocate receipt
                                </Button>
                              )}
                            <Button
                              variant="outline"
                              className="min-h-11"
                              onClick={() =>
                                setPanel({ type: "review", id: payment.id, decision: "void" })
                              }
                            >
                              Void record
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
          {admin && finance.audit.length > 0 && (
            <details className="rounded-lg border p-4 text-sm">
              <summary className="cursor-pointer py-1 font-medium">Payment change history</summary>
              <ol className="mt-3 space-y-3">
                {finance.audit.map((entry) => (
                  <li key={entry.id} className="space-y-1">
                    <p>{auditLabel(entry)}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(entry.created_at).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })}{" "}
                      IST
                    </p>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      ) : (
        <p role="alert" className="text-sm text-destructive">
          Payment totals are unavailable. Refresh before making changes.
        </p>
      )}
    </div>
  );
}

type MilestoneDraft = {
  id: string;
  label: string;
  amount: string;
  due_date: string;
  due_condition: string;
  is_due: boolean;
  has_history: boolean;
};
function PlanForm({ projectId, finance, onSaved, onCancel }: FormProps) {
  const qc = useQueryClient();
  const [baseVersion, setBaseVersion] = useState(finance.plan?.version ?? 0);
  const [total, setTotal] = useState(
    finance.plan ? formatMoneyInput(finance.plan.total_minor) : "",
  );
  const [label, setLabel] = useState(finance.plan?.quote_label ?? "");
  const [scope, setScope] = useState(finance.plan?.scope_notes ?? "");
  const [instructions, setInstructions] = useState(finance.plan?.payment_instructions ?? "");
  const [share, setShare] = useState(finance.plan?.partner_summary_visible ?? false);
  const [rows, setRows] = useState<MilestoneDraft[]>(() =>
    finance.milestones.map((row) => ({
      ...row,
      amount: formatMoneyInput(row.amount_minor),
      due_date: row.due_date ?? "",
    })),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submitting = useRef(false);
  const conflict = (finance.plan?.version ?? 0) !== baseVersion;
  function changeRow(id: string, patch: Partial<MilestoneDraft>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }
  function template() {
    const value = safeAmount(total);
    if (!value || rows.length) return;
    const amounts = [30, 25, 25].map((percent) => Math.floor((value * percent) / 100));
    amounts.push(value - amounts.reduce((sum, amount) => sum + amount, 0));
    setRows(
      amounts.map((amount, index) => ({
        id: crypto.randomUUID(),
        label: `Milestone ${index + 1}`,
        amount: formatMoneyInput(amount),
        due_date: "",
        due_condition: "",
        is_due: false,
        has_history: false,
      })),
    );
  }
  function reload() {
    setBaseVersion(finance.plan?.version ?? 0);
    setTotal(finance.plan ? formatMoneyInput(finance.plan.total_minor) : "");
    setLabel(finance.plan?.quote_label ?? "");
    setScope(finance.plan?.scope_notes ?? "");
    setInstructions(finance.plan?.payment_instructions ?? "");
    setShare(finance.plan?.partner_summary_visible ?? false);
    setRows(
      finance.milestones.map((row) => ({
        ...row,
        amount: formatMoneyInput(row.amount_minor),
        due_date: row.due_date ?? "",
      })),
    );
    setError("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || conflict) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const plan: FinancePlanInput = {
        total_minor: positive(total),
        currency: "INR",
        quote_label: label.trim(),
        scope_notes: scope.trim(),
        payment_instructions: instructions.trim(),
        partner_summary_visible: share,
      };
      const milestones: FinanceMilestoneInput[] = rows.map((row, position) => ({
        id: row.id,
        label: row.label.trim(),
        amount_minor: positive(row.amount),
        due_date: row.due_date || null,
        due_condition: row.due_condition.trim(),
        position,
        is_due: row.is_due,
      }));
      if (milestones.some((row) => !row.label)) throw new Error("Give each milestone a name.");
      const result = await saveProjectFinance(projectId, baseVersion, plan, milestones);
      onSaved(result, "Payment plan saved.");
    } catch (failure) {
      setError(errorMessage(failure, "The payment plan could not be saved."));
      void qc.invalidateQueries({ queryKey: financeQueryKey(projectId) }).catch(() => undefined);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={save}
      className="min-w-0 space-y-4 rounded-lg border bg-card p-4 sm:p-5"
      aria-label="Agreed payment plan"
      aria-busy={busy}
    >
      <h3 className="text-lg">
        {finance.configured ? "Edit agreed payment plan" : "Set up agreed payment plan"}
      </h3>
      <p className="text-sm text-muted-foreground">
        The agreed amount, scope, instructions and milestone details are visible to the client.
      </p>
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="finance-total" label="Agreed project total (₹)">
            <Input
              id="finance-total"
              inputMode="decimal"
              required
              value={total}
              onChange={(event) => setTotal(event.target.value)}
              placeholder="Enter the agreed amount"
            />
          </Field>
          <Field id="finance-label" label="Quote / agreement reference">
            <Input
              id="finance-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={200}
              placeholder="Proposal or agreement reference"
            />
          </Field>
        </div>
        <Field id="finance-scope" label="Agreed scope (optional)">
          <Textarea
            id="finance-scope"
            rows={3}
            maxLength={4000}
            value={scope}
            onChange={(event) => setScope(event.target.value)}
          />
        </Field>
        <Field id="finance-instructions" label="Payment instructions (optional)">
          <Textarea
            id="finance-instructions"
            rows={3}
            maxLength={4000}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Instructions the client should use for payments"
          />
        </Field>
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0"
            checked={share}
            onChange={(event) => setShare(event.target.checked)}
          />
          <span>
            Share payment totals and milestones with project partners
            <span className="mt-1 block text-xs text-muted-foreground">
              Payment references and proofs are visible only to admins and the client. Audit history
              is available to admins only.
            </span>
          </span>
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <h4 className="text-base font-medium">Milestone schedule</h4>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 whitespace-normal"
            onClick={() =>
              setRows((current) => [
                ...current,
                {
                  id: crypto.randomUUID(),
                  label: "",
                  amount: "",
                  due_date: "",
                  due_condition: "",
                  is_due: false,
                  has_history: false,
                },
              ])
            }
          >
            Add milestone
          </Button>
        </div>
        {rows.length === 0 && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Add agreed milestones, or start with the optional 30 / 25 / 25 / 20 execution schedule
              after entering the project amount.
            </p>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 max-w-full whitespace-normal"
              disabled={!safeAmount(total)}
              onClick={template}
            >
              Use 30 / 25 / 25 / 20 schedule
            </Button>
          </div>
        )}
        {rows.map((row, index) => (
          <fieldset key={row.id} className="min-w-0 space-y-3 border-t pt-4">
            <div className="flex items-center justify-between gap-2">
              <h5 className="text-sm font-medium">Milestone {index + 1}</h5>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={row.has_history}
                title={row.has_history ? "Payment history uses this milestone" : undefined}
                onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
              >
                Remove milestone {index + 1}
              </Button>
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <Field id={`milestone-name-${row.id}`} label={`Milestone ${index + 1} name`}>
                <Input
                  id={`milestone-name-${row.id}`}
                  required
                  maxLength={200}
                  value={row.label}
                  onChange={(event) => changeRow(row.id, { label: event.target.value })}
                />
              </Field>
              <Field id={`milestone-amount-${row.id}`} label={`Milestone ${index + 1} amount (₹)`}>
                <Input
                  id={`milestone-amount-${row.id}`}
                  required
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(event) => changeRow(row.id, { amount: event.target.value })}
                />
              </Field>
              <Field
                id={`milestone-date-${row.id}`}
                label={`Milestone ${index + 1} due date (optional)`}
              >
                <Input
                  id={`milestone-date-${row.id}`}
                  type="date"
                  value={row.due_date}
                  onChange={(event) => changeRow(row.id, { due_date: event.target.value })}
                />
              </Field>
              <Field
                id={`milestone-condition-${row.id}`}
                label={`Milestone ${index + 1} due condition (optional)`}
              >
                <Input
                  id={`milestone-condition-${row.id}`}
                  maxLength={1000}
                  value={row.due_condition}
                  onChange={(event) => changeRow(row.id, { due_condition: event.target.value })}
                />
              </Field>
            </div>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={row.is_due}
                onChange={(event) => changeRow(row.id, { is_due: event.target.checked })}
              />
              Ready to collect
            </label>
          </fieldset>
        ))}
      </fieldset>
      {conflict && (
        <div role="alert" className="space-y-2 text-sm">
          <p>
            The payment plan changed while you were editing. Load the latest plan before saving.
          </p>
          <Button type="button" variant="outline" disabled={busy} onClick={reload}>
            Load latest payment plan
          </Button>
        </div>
      )}
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={busy || conflict}>
          {busy ? "Saving payment plan…" : "Save payment plan"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full sm:w-auto"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AllocationFields({
  finance,
  values,
  onChange,
  disabled,
  allowedIds,
}: {
  finance: FinanceBundle;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  disabled: boolean;
  allowedIds?: Set<string>;
}) {
  const rows = finance.milestones.filter((row) => !allowedIds || allowedIds.has(row.id));
  if (!rows.length) return null;
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3 border-t pt-4">
      <legend className="text-sm font-medium">Allocate to milestones (optional)</legend>
      <p className="text-xs text-muted-foreground">
        Leave blank to keep the amount unallocated. Enter only the portion for each milestone.
      </p>
      {rows.map((row) => (
        <Field key={row.id} id={`allocate-${row.id}`} label={`${row.label} allocation (₹)`}>
          <Input
            id={`allocate-${row.id}`}
            inputMode="decimal"
            value={values[row.id] ?? ""}
            onChange={(event) => onChange({ ...values, [row.id]: event.target.value })}
          />
        </Field>
      ))}
    </fieldset>
  );
}

function PaymentForm({
  projectId,
  finance,
  onSaved,
  onCancel,
  mode,
}: FormProps & { mode: "receipt" | "report" | "refund" }) {
  const qc = useQueryClient();
  const refund = mode === "refund",
    report = mode === "report";
  const [amount, setAmount] = useState(""),
    [paidOn, setPaidOn] = useState(projectDay),
    [method, setMethod] = useState("");
  const [reference, setReference] = useState(""),
    [notes, setNotes] = useState("");
  const [purpose, setPurpose] = useState<"advance" | "payment" | "other">(
    report ? "payment" : "advance",
  );
  const receipts = finance.payments.filter(
    (row) =>
      row.kind === "receipt" && row.status === "confirmed" && refundBalance(finance, row) > 0,
  );
  const [related, setRelated] = useState(refund ? (receipts[0]?.id ?? "") : "");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [proof, setProof] = useState<File | null>(null);
  const uploaded = useRef<{ file: File; path: string } | null>(null);
  const identity = useRef(createFinanceRetryIdentity());
  const draftId = useRef<string | null>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const alreadyRecorded =
    !!draftId.current && finance.payments.some((row) => row.id === draftId.current);
  const allowedIds = refund
    ? new Set(
        finance.allocations
          .filter((row) => row.payment_id === related)
          .map((row) => row.milestone_id),
      )
    : undefined;
  function cancel() {
    if (uploaded.current)
      void discardUnlinkedFinanceProof(projectId, uploaded.current.path).catch(() => undefined);
    onCancel();
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || alreadyRecorded) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (!paidOn || paidOn > projectDay())
        throw new Error("Choose the actual payment date up to today.");
      if (!method.trim()) throw new Error("Enter the payment method.");
      const amountMinor = positive(amount);
      if (refund && !related) throw new Error("Select the original confirmed receipt.");
      if (proof && uploaded.current?.file !== proof)
        uploaded.current = { file: proof, path: await uploadFinanceProof(projectId, proof) };
      const fields = {
        kind: refund ? ("refund" as const) : ("receipt" as const),
        purpose: refund ? ("other" as const) : purpose,
        amount_minor: amountMinor,
        paid_on: paidOn,
        method: method.trim(),
        reference: reference.trim(),
        notes: notes.trim(),
        proof_path: proof ? (uploaded.current?.path ?? null) : null,
        related_payment_id: refund ? related : null,
      };
      const allocated = report ? [] : allocationInput(allocations);
      const payment: FinancePaymentInput = {
        ...fields,
        id: identity.current.forPayload({ projectId, fields, allocations: allocated }),
      };
      draftId.current = payment.id;
      const result = await recordProjectPayment(projectId, payment, allocated);
      onSaved(
        result,
        report
          ? "Payment reported. It will count as paid after Spacenez confirms it."
          : refund
            ? "Returned refund recorded."
            : "Received payment recorded.",
      );
    } catch (failure) {
      setError(
        errorMessage(failure, "The payment could not be saved. Your details have been kept."),
      );
      void qc.invalidateQueries({ queryKey: financeQueryKey(projectId) }).catch(() => undefined);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      aria-label={
        report ? "Report payment" : refund ? "Record returned refund" : "Record received payment"
      }
      aria-busy={busy}
      className="min-w-0 space-y-4 rounded-lg border bg-card p-4 sm:p-5"
    >
      <h3 className="text-lg">
        {report
          ? "Report a payment"
          : refund
            ? "Record an already returned refund"
            : "Record an already received payment"}
      </h3>
      <p className="text-sm text-muted-foreground">
        {report
          ? "Enter a payment you have already made. Spacenez will verify it before it counts as paid."
          : refund
            ? "Record money already returned to the client. This does not issue a bank or gateway refund."
            : "Record money already received. This does not charge the client."}
      </p>
      {alreadyRecorded && (
        <p role="alert" className="text-sm">
          This payment is already recorded. Close this form to review its history; changes here have
          not been saved.
        </p>
      )}
      <fieldset disabled={busy || alreadyRecorded} className="min-w-0 space-y-4">
        {refund && (
          <Field id="refund-receipt" label="Original confirmed receipt">
            <select
              id="refund-receipt"
              className={inputClass}
              required
              value={related}
              onChange={(event) => {
                setRelated(event.target.value);
                setAllocations({});
              }}
            >
              <option value="">Choose a receipt</option>
              {receipts.map((row) => (
                <option key={row.id} value={row.id}>
                  {receiptName(row)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!refund && (
          <Field id="payment-purpose" label="Payment for">
            <select
              id="payment-purpose"
              className={inputClass}
              value={purpose}
              onChange={(event) => setPurpose(event.target.value as typeof purpose)}
            >
              <option value="advance">Advance / token</option>
              <option value="payment">Milestone payment</option>
              <option value="other">Other agreed payment</option>
            </select>
          </Field>
        )}
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field
            id="payment-amount"
            label={
              report ? "Amount paid (₹)" : refund ? "Amount returned (₹)" : "Amount received (₹)"
            }
          >
            <Input
              id="payment-amount"
              required
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="Enter the actual amount"
            />
          </Field>
          <Field id="payment-date" label="Payment date">
            <Input
              id="payment-date"
              required
              type="date"
              max={projectDay()}
              value={paidOn}
              onChange={(event) => setPaidOn(event.target.value)}
            />
          </Field>
          <Field id="payment-method" label="Payment method">
            <Input
              id="payment-method"
              required
              maxLength={80}
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              placeholder="UPI, bank transfer, cash…"
            />
          </Field>
          <Field id="payment-reference" label="Reference (optional)">
            <Input
              id="payment-reference"
              maxLength={200}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Transaction or receipt reference"
            />
          </Field>
        </div>
        <Field id="payment-notes" label="Notes (optional)">
          <Textarea
            id="payment-notes"
            rows={3}
            maxLength={4000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Payment notes and references are visible to Spacenez admins and the client.
          </p>
        </Field>
        <Field id="payment-proof" label="Payment proof (optional)">
          <Input
            id="payment-proof"
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp"
            onChange={(event) => {
              if (uploaded.current)
                void discardUnlinkedFinanceProof(projectId, uploaded.current.path).catch(
                  () => undefined,
                );
              setProof(event.target.files?.[0] ?? null);
              uploaded.current = null;
            }}
          />
          <p className="text-xs text-muted-foreground">
            PDF, PNG, JPG or WebP, up to 5 MB. Proof is private to Spacenez admins and the client.
          </p>
        </Field>
        {!report && (
          <AllocationFields
            finance={finance}
            values={allocations}
            onChange={setAllocations}
            disabled={busy}
            {...(allowedIds ? { allowedIds } : {})}
          />
        )}
        {refund && (
          <p className="text-xs text-muted-foreground">
            Allocate the refund to reverse the original milestone allocations. Any remainder must
            come from that receipt’s unallocated funds.
          </p>
        )}
      </fieldset>
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          className="min-h-11 w-full sm:w-auto"
          disabled={busy || alreadyRecorded}
        >
          {busy
            ? "Saving payment…"
            : report
              ? "Report payment"
              : refund
                ? "Record returned refund"
                : "Save received payment"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full sm:w-auto"
          disabled={busy}
          onClick={cancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ReviewForm({
  finance,
  onSaved,
  onCancel,
  paymentId,
  decision,
}: FormProps & { paymentId: string; decision: "confirm" | "reject" | "void" }) {
  const payment = finance.payments.find((row) => row.id === paymentId);
  const [reason, setReason] = useState(""),
    [allocations, setAllocations] = useState<Record<string, string>>(() =>
      allocationValues(finance, paymentId),
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submitting = useRef(false);
  const stale =
    !payment ||
    (decision === "void" ? payment.status !== "confirmed" : payment.status !== "reported");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || stale) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (decision !== "confirm" && !reason.trim())
        throw new Error("Enter the reason for this change.");
      const result = await reviewProjectPayment(
        paymentId,
        decision,
        reason.trim(),
        decision === "confirm" ? allocationInput(allocations) : undefined,
      );
      onSaved(
        result,
        decision === "confirm"
          ? "Payment confirmed."
          : decision === "reject"
            ? "Payment report rejected."
            : "Payment record voided; its history is retained.",
      );
    } catch (failure) {
      setError(errorMessage(failure, "The payment review could not be saved."));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      aria-label="Review payment"
      aria-busy={busy}
      className="min-w-0 space-y-4 rounded-lg border bg-card p-4 sm:p-5"
    >
      <h3 className="text-lg">
        {decision === "confirm"
          ? "Confirm received payment"
          : decision === "reject"
            ? "Reject payment report"
            : "Void payment record"}
      </h3>
      {payment && (
        <p className="text-sm">
          {receiptName(payment)}
          {payment.reference ? ` · ${payment.reference}` : ""}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {decision === "confirm"
          ? "Confirm after checking the actual bank or payment record."
          : decision === "void"
            ? "Voiding corrects this record; it does not return money. Record an actual refund separately."
            : "The client will see the reason for rejection."}
      </p>
      {stale && (
        <p role="alert" className="text-sm">
          This payment has already changed. Close this form and check its current status.
        </p>
      )}
      <fieldset disabled={busy || stale} className="space-y-4">
        <Field
          id="payment-review-reason"
          label={decision === "confirm" ? "Verification note (optional)" : "Reason"}
        >
          <Textarea
            id="payment-review-reason"
            required={decision !== "confirm"}
            maxLength={1000}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            This review note is visible to the client.
          </p>
        </Field>
        {decision === "confirm" && (
          <AllocationFields
            finance={finance}
            values={allocations}
            onChange={setAllocations}
            disabled={busy || stale}
          />
        )}
      </fieldset>
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11 w-full sm:w-auto" type="submit" disabled={busy || stale}>
          {busy
            ? "Saving review…"
            : decision === "confirm"
              ? "Confirm payment"
              : decision === "reject"
                ? "Reject report"
                : "Void record"}
        </Button>
        <Button
          className="min-h-11 w-full sm:w-auto"
          variant="outline"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AllocateForm({
  finance,
  onSaved,
  onCancel,
  paymentId,
}: FormProps & { paymentId: string }) {
  const payment = finance.payments.find((row) => row.id === paymentId);
  const [values, setValues] = useState<Record<string, string>>(() =>
    allocationValues(finance, paymentId),
  );
  const [baseAllocation] = useState(() =>
    JSON.stringify(Object.entries(allocationValues(finance, paymentId)).sort()),
  );
  const stale =
    !payment ||
    payment.status !== "confirmed" ||
    payment.kind !== "receipt" ||
    finance.payments.some(
      (row) =>
        row.kind === "refund" && row.related_payment_id === paymentId && row.status === "confirmed",
    ) ||
    baseAllocation !== JSON.stringify(Object.entries(allocationValues(finance, paymentId)).sort());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submitting = useRef(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || stale) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await allocateProjectPayment(paymentId, allocationInput(values));
      onSaved(result, "Receipt allocation saved.");
    } catch (failure) {
      setError(errorMessage(failure, "Allocation could not be saved."));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      aria-label="Allocate receipt"
      aria-busy={busy}
      className="min-w-0 space-y-4 rounded-lg border bg-card p-4 sm:p-5"
    >
      <h3 className="text-lg">Allocate confirmed receipt</h3>
      {payment && <p className="text-sm">{receiptName(payment)}</p>}
      {stale && (
        <p role="alert" className="text-sm">
          This receipt or its allocations changed. Close this form and check the latest payment
          details.
        </p>
      )}
      <AllocationFields
        finance={finance}
        values={values}
        onChange={setValues}
        disabled={busy || stale}
      />
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={busy || stale}>
          {busy ? "Saving allocation…" : "Save allocation"}
        </Button>
        <Button
          type="button"
          className="min-h-11 w-full sm:w-auto"
          variant="outline"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
