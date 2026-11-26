import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reorderProjectStages, useProjectStageMutations } from "./project-stages";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
beforeEach(() => vi.resetAllMocks());

describe("project heading requests", () => {
  it("reorders the complete catalog while preserving stable stage keys", () => {
    expect(reorderProjectStages(["a", "b", "c", "d"], "b", "d")).toEqual(["a", "c", "d", "b"]);
    expect(reorderProjectStages(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(reorderProjectStages(["a", "b"], "unknown", "a")).toEqual(["a", "b"]);
  });

  it("retries an ambiguous failure with its original UUID, version and exact payload", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce({ data: { version: 2, stage_key: "custom_a" }, error: null });
    const onReload = vi.fn().mockResolvedValue(undefined), onSaved = vi.fn();
    const view = renderHook(({ version }) => useProjectStageMutations({ projectId: "project", actorId: "admin", version, onReload, onSaved }), { initialProps: { version: 1 } });
    const action = { type: "add" as const, label: "Kitchen" };
    await act(async () => { await view.result.current.mutate(action); });
    const first = mocks.rpc.mock.calls[0]![1];
    expect(first).toMatchObject({ p_project_id: "project", p_expected_version: 1, p_action: { type: "add", label: "Kitchen" } });
    expect(first.p_request_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(view.result.current.pending).not.toBeNull();
    action.label = "A different label";
    view.rerender({ version: 9 });
    await act(async () => { expect(await view.result.current.mutate({ type: "add", label: "Another heading" })).toBe(false); });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    await act(async () => { await view.result.current.retry(); });
    expect(mocks.rpc.mock.calls[1]![1]).toEqual(first);
    expect(onSaved).toHaveBeenCalledWith({ type: "add", label: "Kitchen" }, { version: 2, stage_key: "custom_a" });
    expect(view.result.current.pending).toBeNull();
  });

  it("retries only refresh after a confirmed save whose refresh failed", async () => {
    mocks.rpc.mockResolvedValue({ data: { version: 4 }, error: null });
    const onReload = vi.fn().mockRejectedValueOnce(new Error("Refresh failed")).mockResolvedValue(undefined), onSaved = vi.fn();
    const { result } = renderHook(() => useProjectStageMutations({ projectId: "project", actorId: "admin", version: 3, onReload, onSaved }));
    await act(async () => { await result.current.mutate({ type: "rename", key: "a", label: "Updated heading" }); });
    expect(result.current.error?.saved).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    await act(async () => { await result.current.retry(); });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(onReload).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("refreshes on version conflict and requires review before a new version is submitted", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "Revision changed" } });
    const onReload = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useProjectStageMutations({ projectId: "project", actorId: "admin", version: 7, onReload }));
    await act(async () => { await result.current.mutate({ type: "rename", key: "a", label: "Updated" }, 2); });
    expect(mocks.rpc.mock.calls[0]![1].p_expected_version).toBe(2);
    expect(onReload).toHaveBeenCalledOnce();
    expect(result.current.pending).toBeNull();
    expect(result.current.error?.conflict).toBe(true);
    await act(async () => { expect(await result.current.retry()).toBe(false); });
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("locks overlapping changes and keeps rejected drafts separate from unresolved requests", async () => {
    let resolve!: (value: unknown) => void;
    mocks.rpc.mockImplementationOnce(() => new Promise((finish) => { resolve = finish; }));
    const { result } = renderHook(() => useProjectStageMutations({ projectId: "project", actorId: "admin", version: 1 }));
    let saving!: Promise<boolean>;
    act(() => { saving = result.current.mutate({ type: "add", label: "Kitchen" }); });
    await act(async () => { expect(await result.current.mutate({ type: "add", label: "Bathroom" })).toBe(false); });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    await act(async () => { resolve({ data: null, error: { code: "22023", message: "Invalid name" } }); await saving; });
    expect(result.current.pending).not.toBeNull();
    expect(result.current.error?.definite).toBe(true);
    act(() => result.current.discardRejected());
    expect(result.current.pending).toBeNull();
  });

  it("scopes unresolved requests by actor and project and ignores old in-flight UI callbacks", async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.rpc.mockImplementationOnce(() => new Promise((finish) => { resolveOld = finish; }))
      .mockResolvedValueOnce({ data: { version: 2, stage_key: "custom_b" }, error: null });
    const onReload = vi.fn().mockResolvedValue(undefined), onSaved = vi.fn();
    const view = renderHook(({ projectId, actorId }) => useProjectStageMutations({ projectId, actorId, version: 1, onReload, onSaved }), { initialProps: { projectId: "project-a", actorId: "admin-a" } });
    let oldSaving!: Promise<boolean>;
    act(() => { oldSaving = view.result.current.mutate({ type: "add", label: "Original project heading" }); });
    view.rerender({ projectId: "project-b", actorId: "admin-a" });
    expect(view.result.current.pending).toBeNull();
    expect(view.result.current.busy).toBe(false);
    await act(async () => { await view.result.current.mutate({ type: "add", label: "New project heading" }); });
    expect(mocks.rpc.mock.calls[1]![1]).toMatchObject({ p_project_id: "project-b", p_action: { type: "add", label: "New project heading" } });
    expect(onSaved).toHaveBeenCalledOnce();
    await act(async () => { resolveOld({ data: { version: 2, stage_key: "custom_a" }, error: null }); await oldSaving; });
    expect(onSaved).toHaveBeenCalledOnce();
    expect(view.result.current.pending).toBeNull();

    mocks.rpc.mockRejectedValueOnce(new Error("Connection lost"));
    view.rerender({ projectId: "project-c", actorId: "admin-a" });
    await act(async () => { await view.result.current.mutate({ type: "add", label: "Unconfirmed heading" }); });
    const original = mocks.rpc.mock.calls[2]![1];
    view.rerender({ projectId: "project-c", actorId: "admin-b" });
    expect(view.result.current.pending).toBeNull();
    view.rerender({ projectId: "project-c", actorId: "admin-a" });
    expect(view.result.current.pending?.requestId).toBe(original.p_request_id);
    mocks.rpc.mockResolvedValueOnce({ data: { version: 2, stage_key: "custom_c" }, error: null });
    await act(async () => { await view.result.current.retry(); });
    expect(mocks.rpc.mock.calls[3]![1]).toEqual(original);
  });
});
