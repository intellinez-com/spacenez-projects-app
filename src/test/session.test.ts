import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthSessionMissingError, type User } from "@supabase/supabase-js";
import { readPortalUser } from "@/lib/session";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getUser } } }));

beforeEach(() => { getUser.mockReset(); });

describe("verified portal session", () => {
  it("returns the verified user", async () => {
    const user = { id: "client-a" } as User;
    getUser.mockResolvedValue({ data: { user }, error: null });
    await expect(readPortalUser()).resolves.toBe(user);
  });

  it("recognizes absent and rejected sessions", async () => {
    for (const error of [new AuthSessionMissingError(), new AuthApiError("Invalid token", 401, "bad_jwt")]) {
      getUser.mockResolvedValue({ data: { user: null }, error });
      await expect(readPortalUser()).resolves.toBeNull();
    }
  });

  it("does not turn a temporary auth service failure into a sign-out", async () => {
    const error = new AuthApiError("Service unavailable", 503, "unexpected_failure");
    getUser.mockResolvedValue({ data: { user: null }, error });
    await expect(readPortalUser()).rejects.toBe(error);
  });

  it("keeps thrown connection and storage errors retryable", async () => {
    const error = new TypeError("Failed to fetch");
    getUser.mockRejectedValue(error);
    await expect(readPortalUser()).rejects.toBe(error);
  });
});
