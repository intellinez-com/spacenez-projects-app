import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localPreviewRole } from "./role";

beforeEach(() => { sessionStorage.clear(); window.history.replaceState({}, "", "/dashboard"); });
afterEach(() => { vi.unstubAllEnvs(); sessionStorage.clear(); window.history.replaceState({}, "", "/"); });

describe("serve-only sample role selection", () => {
  it("ignores the admin query outside client-preview mode", () => {
    vi.stubEnv("MODE", "production");
    window.history.replaceState({}, "", "/dashboard?previewRole=admin");
    expect(localPreviewRole()).toBe("client");
    expect(sessionStorage.getItem("spacenez-local-preview-role")).toBeNull();
  });
  it("keeps the explicit demo choice in this tab until the user switches back", () => {
    vi.stubEnv("MODE", "client-preview");
    window.history.replaceState({}, "", "/dashboard?previewRole=admin");
    expect(localPreviewRole()).toBe("admin");
    window.history.replaceState({}, "", "/projects/sample");
    expect(localPreviewRole()).toBe("admin");
    window.history.replaceState({}, "", "/dashboard?previewRole=client");
    expect(localPreviewRole()).toBe("client");
  });
});
