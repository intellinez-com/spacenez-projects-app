// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { brokeredPreviewStorage } from "@/integrations/supabase/previewAuthStorage";

const projectId = "00000000-0000-4000-8000-000000000001";
const previewHost = `id-preview--${projectId}.lovableproject.com`;
type BrokerMessage = { type: string; requestId: string; projectId: string; key: string; value?: string };

function localStore() {
  const disk = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => disk.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { disk.set(key, value); }),
    removeItem: vi.fn((key: string) => { disk.delete(key); }),
  };
  return { disk, storage };
}

function browser(options: { hostname?: string; ancestor?: string; framed?: boolean; getStorage?: () => ReturnType<typeof localStore>["storage"] } = {}) {
  const local = localStore();
  const target = new EventTarget();
  const parent = { postMessage: vi.fn<(message: BrokerMessage, origin: string) => void>() };
  Object.defineProperties(target, {
    parent: { value: options.framed ? parent : target },
    localStorage: { get: options.getStorage ?? (() => local.storage) },
  });
  vi.stubGlobal("window", target);
  vi.stubGlobal("location", { hostname: options.hostname ?? "app.spacenez.com", ancestorOrigins: [options.ancestor ?? "https://lovable.dev"] });
  vi.stubGlobal("document", { referrer: "" });
  return { ...local, target, parent };
}

function reply(target: EventTarget, request: BrokerMessage, origin: string, value: string | null) {
  target.dispatchEvent(new MessageEvent("message", { origin, data: { type: "lovable-preview-auth:result", requestId: request.requestId, ok: true, value } }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("browser auth storage fallback", () => {
  it("keeps normal persistence and reads current cross-tab values", async () => {
    const { disk, parent } = browser();
    const adapter = brokeredPreviewStorage()!;
    await adapter.setItem("session", "first");
    expect(disk.get("session")).toBe("first");
    disk.set("session", "from-another-tab");
    expect(await adapter.getItem("session")).toBe("from-another-tab");
    disk.delete("session");
    expect(await adapter.getItem("session")).toBeNull();
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it("uses separate in-memory sessions when the localStorage getter throws", async () => {
    browser({ getStorage: () => { throw new Error("Storage access denied"); } });
    const adapter = brokeredPreviewStorage()!;
    const otherClient = brokeredPreviewStorage()!;
    expect(await adapter.getItem("session")).toBeNull();
    await adapter.setItem("session", "memory-session");
    expect(await adapter.getItem("session")).toBe("memory-session");
    expect(await otherClient.getItem("session")).toBeNull();
    await adapter.removeItem("session");
    expect(await adapter.getItem("session")).toBeNull();
  });

  it("retains current state if getItem starts throwing after initialization", async () => {
    const { storage, disk } = browser();
    disk.set("session", "original");
    const adapter = brokeredPreviewStorage()!;
    expect(await adapter.getItem("session")).toBe("original");
    storage.getItem.mockImplementation(() => { throw new Error("Read blocked"); });
    expect(await adapter.getItem("session")).toBe("original");
    await adapter.setItem("session", "new-session");
    expect(await adapter.getItem("session")).toBe("new-session");
    await adapter.removeItem("session");
    expect(await adapter.getItem("session")).toBeNull();
  });

  it("uses a new in-memory value when setItem fails instead of returning stale disk data", async () => {
    const { storage, disk } = browser();
    disk.set("session", "stale-session");
    storage.setItem.mockImplementation(() => { throw new Error("Quota exceeded"); });
    const adapter = brokeredPreviewStorage()!;
    await adapter.setItem("session", "current-session");
    expect(await adapter.getItem("session")).toBe("current-session");
    expect(disk.get("session")).toBe("stale-session");
    await adapter.removeItem("session");
    expect(await adapter.getItem("session")).toBeNull();
  });

  it("does not resurrect a session after failed removal and recovers persistence safely", async () => {
    const { storage, disk } = browser();
    disk.set("session", "stale-session");
    storage.removeItem.mockImplementation(() => { throw new Error("Removal blocked"); });
    const adapter = brokeredPreviewStorage()!;
    await adapter.removeItem("session");
    expect(await adapter.getItem("session")).toBeNull();
    expect(disk.get("session")).toBe("stale-session");
    storage.removeItem.mockImplementation((key) => { disk.delete(key); });
    expect(await adapter.getItem("session")).toBeNull();
    expect(disk.has("session")).toBe(false);
    disk.set("session", "fresh-cross-tab-session");
    expect(await adapter.getItem("session")).toBe("fresh-cross-tab-session");
  });
});

describe("editor broker storage and origin guards", () => {
  it("still brokers set/get/remove when all localStorage access is blocked", async () => {
    const { target, parent } = browser({ hostname: previewHost, framed: true, getStorage: () => { throw new Error("Third-party storage blocked"); } });
    const sessions = new Map<string, string>();
    parent.postMessage.mockImplementation((message, origin) => {
      expect(origin).toBe("https://lovable.dev");
      expect(message.projectId).toBe(projectId);
      if (message.type.endsWith(":set")) sessions.set(message.key, message.value!);
      if (message.type.endsWith(":remove")) sessions.set(message.key, "");
      reply(target, message, origin, sessions.get(message.key) ?? null);
    });
    const adapter = brokeredPreviewStorage()!;
    await adapter.setItem("session", "broker-session");
    expect(await adapter.getItem("session")).toBe("broker-session");
    await adapter.removeItem("session");
    expect(await adapter.getItem("session")).toBeNull();
    expect(parent.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
      "lovable-preview-auth:set", "lovable-preview-auth:get", "lovable-preview-auth:remove", "lovable-preview-auth:get",
    ]);
  });

  it("preserves an editor logout tombstone if disk removal fails and the editor goes silent", async () => {
    vi.useFakeTimers();
    const { target, parent, storage, disk } = browser({ hostname: previewHost, framed: true });
    disk.set("session", "stale-session");
    storage.removeItem.mockImplementation(() => { throw new Error("Removal blocked"); });
    parent.postMessage.mockImplementation((message, origin) => reply(target, message, origin, ""));
    const adapter = brokeredPreviewStorage()!;
    expect(await adapter.getItem("session")).toBeNull();
    parent.postMessage.mockImplementation(() => {});
    const later = adapter.getItem("session");
    await vi.runAllTimersAsync();
    expect(await later).toBeNull();
    expect(disk.get("session")).toBe("stale-session");
  });

  it("rejects an untrusted ancestor's reply and never targets that ancestor", async () => {
    vi.useFakeTimers();
    const { target, parent, disk } = browser({ hostname: previewHost, framed: true, ancestor: "https://untrusted.example" });
    disk.set("session", "local-session");
    const adapter = brokeredPreviewStorage()!;
    const result = adapter.getItem("session");
    const request = parent.postMessage.mock.calls[0]![0];
    reply(target, request, "https://untrusted.example", "attacker-session");
    await vi.runAllTimersAsync();
    expect(await result).toBe("local-session");
    expect(parent.postMessage.mock.calls.every(([, origin]) => origin === "https://lovable.dev")).toBe(true);
  });

  it.each([
    `id-preview--${projectId}.lovableproject.com.untrusted.example`,
    `preview--${projectId}.lovableproject.com`,
    "project--00000000-0000-1000-8000-000000000001.lovableproject.com",
  ])("does not broker sessions from an unapproved host position: %s", async (hostname) => {
    const { parent } = browser({ hostname, framed: true });
    const adapter = brokeredPreviewStorage()!;
    await adapter.setItem("session", "local-only");
    expect(await adapter.getItem("session")).toBe("local-only");
    expect(parent.postMessage).not.toHaveBeenCalled();
  });
});
