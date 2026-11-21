// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPreviewFinanceSession } from "@/preview/finance";
import { createPreviewFixtures, previewIds } from "@/preview/fixtures";

const ids = [1, 2, 3, 4].map((value) => `eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee${value}`);
const paymentId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const refundId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const date = "2026-01-01";
const plan = { total_minor: 50_000_000, currency: "INR", quote_label: "Fictional demo agreement", scope_notes: "Sample only", payment_instructions: "Do not send money", partner_summary_visible: false };
const milestones = [15_000_000, 12_500_000, 12_500_000, 10_000_000].map((amount_minor, index) => ({ id: ids[index], label: `Sample milestone ${index + 1}`, amount_minor, due_date: null, due_condition: "Fictional agreement", position: index, is_due: index === 0 }));
const receipt = { id: paymentId, kind: "receipt", purpose: "advance", amount_minor: 5_000_000, paid_on: date, method: "Bank transfer", reference: "FICTIONAL-ADVANCE", notes: "Already received, sample only", proof_path: null, related_payment_id: null };

afterEach(() => { vi.doUnmock("@/preview/role"); vi.resetModules(); });

describe("usable isolated admin payment preview", () => {
  it("starts blank, saves the agreement and records an allocated advance with correct totals", () => {
    const demo = createPreviewFinanceSession("admin", previewIds.admin);
    expect(demo.read()).toMatchObject({ access: "admin", configured: false, plan: null, summary: null, milestones: [], payments: [] });
    expect(() => demo.record(receipt)).toThrow("Configure");
    const saved = demo.save(0, plan, milestones);
    expect(saved.plan).toMatchObject({ total_minor: 50_000_000, version: 1, created_by: previewIds.admin });
    expect(saved.summary).toMatchObject({ due_now_minor: 15_000_000, outstanding_minor: 50_000_000 });
    const recorded = demo.record(receipt, [{ milestone_id: ids[0], amount_minor: 5_000_000 }]);
    expect(recorded.payments[0]).toMatchObject({ status: "confirmed", verified_by: previewIds.admin });
    expect(recorded.summary).toMatchObject({ net_received_minor: 5_000_000, outstanding_minor: 45_000_000, due_now_minor: 10_000_000, unallocated_minor: 0 });
    expect(recorded.milestones[0]).toMatchObject({ paid_minor: 5_000_000, has_history: true });
    expect(recorded.audit.length).toBeGreaterThan(0);
    expect(demo.record(receipt, [{ milestone_id: ids[0], amount_minor: 5_000_000 }]).payments).toHaveLength(1);
    expect(() => demo.record({ ...receipt, notes: "Changed after lost response" }, [{ milestone_id: ids[0], amount_minor: 5_000_000 }])).toThrow("different details");
    expect(demo.read().payments).toHaveLength(1);
  });

  it("validates edits atomically and preserves recorded milestone history", () => {
    const demo = createPreviewFinanceSession("admin", previewIds.admin);
    demo.save(0, plan, milestones);
    demo.record(receipt, [{ milestone_id: ids[0], amount_minor: 5_000_000 }]);
    const before = demo.read();
    expect(() => demo.save(0, plan, milestones)).toThrow("changed");
    expect(() => demo.save(1, plan, milestones.slice(1))).toThrow("history");
    expect(() => demo.save(1, { ...plan, total_minor: 1 }, milestones)).toThrow("exceed");
    expect(demo.read()).toEqual(before);
    const partial = createPreviewFinanceSession("admin", previewIds.admin);
    expect(partial.save(0, plan, []).summary?.outstanding_minor).toBe(50_000_000);
  });

  it("records returned refunds against the original allocation and prevents over-refund or duplicate receipt changes", () => {
    const demo = createPreviewFinanceSession("admin", previewIds.admin);
    demo.save(0, plan, milestones);
    demo.record(receipt, [{ milestone_id: ids[0], amount_minor: 5_000_000 }]);
    const refund = { ...receipt, id: refundId, kind: "refund", purpose: "other", amount_minor: 1_000_000, related_payment_id: paymentId };
    expect(() => demo.record(refund)).toThrow("refunded milestones");
    const result = demo.record(refund, [{ milestone_id: ids[0], amount_minor: 1_000_000 }]);
    expect(result.summary).toMatchObject({ net_received_minor: 4_000_000, refunded_minor: 1_000_000, outstanding_minor: 46_000_000, due_now_minor: 11_000_000 });
    expect(() => demo.allocate(paymentId, [])).toThrow("linked refunds");
    expect(() => demo.review(paymentId, "void", "Correction")).toThrow("linked refunds");
    expect(demo.review(refundId, "void", "Fictional correction").summary?.net_received_minor).toBe(5_000_000);
    expect(demo.allocate(paymentId, []).summary?.unallocated_minor).toBe(5_000_000);
    expect(demo.review(paymentId, "void", "Fictional correction").summary?.net_received_minor).toBe(0);
  });

  it("keeps the default client fixture and prevents client mutation of the plan or allocations", () => {
    const client = createPreviewFinanceSession("client", previewIds.client);
    expect(client.read()).toMatchObject({ access: "client", configured: true });
    expect(() => client.save(1, plan, milestones)).toThrow("admin preview");
    expect(() => client.allocate(paymentId, [])).toThrow("admin preview");
    expect(createPreviewFixtures().user_roles[0]).toMatchObject({ user_id: previewIds.client, role: "client" });
    expect(createPreviewFixtures("admin").user_roles[0]).toMatchObject({ user_id: previewIds.admin, role: "admin" });
  });

  it("exposes admin RPCs only through the closed local demo transport, with a fictional admin session", async () => {
    vi.resetModules();
    vi.doMock("@/preview/role", () => ({ localPreviewRole: () => "admin" }));
    const { previewFetch, previewUser } = await import("@/preview/client");
    expect(previewUser).toMatchObject({ id: previewIds.admin, email: "admin@example.test" });
    const call = (rpc: string, body: unknown) => previewFetch(`http://127.0.0.1:4173/rest/v1/rpc/${rpc}`, { method: "POST", body: JSON.stringify(body) });
    const empty = await (await call("get_project_finance", { p_project_id: previewIds.project })).json();
    expect(empty).toMatchObject({ access: "admin", configured: false, plan: null });
    expect((await call("save_project_finance", { p_project_id: previewIds.project, p_expected_version: 0, p_plan: plan, p_milestones: milestones })).ok).toBe(true);
    const response = await call("record_project_payment", { p_project_id: previewIds.project, p_payment: receipt, p_allocations: [{ milestone_id: ids[0], amount_minor: 5_000_000 }] });
    expect((await response.json()).summary).toMatchObject({ outstanding_minor: 45_000_000, due_now_minor: 10_000_000 });
    expect((await previewFetch("https://example.supabase.co/rest/v1/projects")).status).toBe(403);
    expect((await call("save_project_finance", { p_project_id: "another-project" })).status).toBe(403);
  });
});
