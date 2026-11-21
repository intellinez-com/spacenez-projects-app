// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { previewIds } from "@/preview/fixtures";

describe("isolated payment preview", () => {
  it("keeps client reports pending, retries without duplicates and cannot reach a live backend", async () => {
    vi.resetModules();
    const { previewFetch } = await import("@/preview/client");
    const call = async (rpc: string, body: unknown) =>
      previewFetch(`http://127.0.0.1:4173/rest/v1/rpc/${rpc}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const initial = await (
      await call("get_project_finance", { p_project_id: previewIds.project })
    ).json();
    const payload = {
      p_project_id: previewIds.project,
      p_payment: {
        id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
        kind: "receipt",
        purpose: "payment",
        amount_minor: 250_000,
        paid_on: initial.payments[0].paid_on,
        method: "UPI",
        reference: "PREVIEW-ONLY",
        notes: "Sample report",
        proof_path: null,
      },
      p_allocations: [],
    };
    const reported = await (await call("record_project_payment", payload)).json();
    expect(reported.payments[0]).toMatchObject({
      status: "reported",
      verified_by: null,
      amount_minor: 250_000,
    });
    expect(reported.summary).toMatchObject({
      net_received_minor: 3_000_000,
      outstanding_minor: 7_000_000,
      pending_minor: 250_000,
    });
    const retried = await (await call("record_project_payment", payload)).json();
    expect(retried.payments).toHaveLength(2);
    expect(retried.summary.pending_minor).toBe(250_000);
    expect(
      (
        await call("record_project_payment", {
          ...payload,
          p_payment: { ...payload.p_payment, amount_minor: 300_000 },
        })
      ).status,
    ).toBe(403);
    expect((await call("save_project_finance", {})).status).toBe(403);
    expect((await call("get_project_finance", { p_project_id: "not-this-project" })).status).toBe(
      403,
    );
    expect(
      (await previewFetch("https://cwhofudilhawuvmhzgdx.supabase.co/rest/v1/projects")).status,
    ).toBe(403);
  });

  it("keeps sample proofs in memory and retains files linked to payment history", async () => {
    vi.resetModules();
    const { previewFetch } = await import("@/preview/client");
    const path = `${previewIds.project}/${previewIds.client}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-proof.pdf`;
    const form = new FormData();
    form.append("", new Blob(["%PDF-1.4 sample proof"], { type: "application/pdf" }), "proof.pdf");
    expect(
      (
        await previewFetch(`http://127.0.0.1:4173/storage/v1/object/project-finance/${path}`, {
          method: "POST",
          body: form,
        })
      ).ok,
    ).toBe(true);
    const call = (rpc: string, body: unknown) =>
      previewFetch(`http://127.0.0.1:4173/rest/v1/rpc/${rpc}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    const current = await (
      await call("get_project_finance", { p_project_id: previewIds.project })
    ).json();
    expect(
      (
        await call("record_project_payment", {
          p_project_id: previewIds.project,
          p_payment: {
            id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
            kind: "receipt",
            purpose: "payment",
            amount_minor: 100,
            paid_on: current.payments[0].paid_on,
            proof_path: path,
          },
          p_allocations: [],
        })
      ).ok,
    ).toBe(true);
    const signed = await previewFetch(
      `http://127.0.0.1:4173/storage/v1/object/sign/project-finance/${path}`,
      { method: "POST", body: "{}" },
    );
    const signedPath = (await signed.json()).signedURL;
    const file = await previewFetch(`http://127.0.0.1:4173/storage/v1${signedPath}`);
    expect(await file.text()).toContain("sample proof");
    expect(
      (
        await previewFetch("http://127.0.0.1:4173/storage/v1/object/project-finance", {
          method: "DELETE",
          body: JSON.stringify({ prefixes: [path] }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await previewFetch(
          `http://127.0.0.1:4173/storage/v1/object/sign/project-finance/${previewIds.project}/someone-else/proof.pdf`,
          { method: "POST", body: "{}" },
        )
      ).status,
    ).toBe(403);
  });
});
