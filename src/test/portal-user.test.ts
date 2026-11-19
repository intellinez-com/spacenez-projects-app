import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { portalUserInput } from "@/lib/portal-user-input";
import { provisionPortalUser } from "@/lib/provision-user.server";

const input = { email: "client@example.test", password: "temporary-password", full_name: "Client", role: "client" as const };
function fixture(roleError: unknown = null, cleanupError: unknown = null) {
  const deleteUser = vi.fn().mockResolvedValue({ error: cleanupError });
  const insert = vi.fn().mockResolvedValue({ error: roleError });
  const from = vi.fn(() => ({ delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }), insert }));
  const client = { auth: { admin: { createUser: vi.fn().mockResolvedValue({ data: { user: { id: "new-user" } }, error: null }), deleteUser } }, from };
  return { client: client as unknown as SupabaseClient<Database>, deleteUser, insert };
}

describe("invite-only account provisioning", () => {
  it("normalizes account input and rejects invalid identity fields", () => {
    expect(portalUserInput.parse({ ...input, email: " CLIENT@example.test ", full_name: " Client " }).email).toBe("client@example.test");
    expect(portalUserInput.safeParse({ ...input, full_name: " " }).success).toBe(false);
    expect(portalUserInput.safeParse({ ...input, email: "not-an-email" }).success).toBe(false);
    expect(portalUserInput.safeParse({ ...input, role: "owner" }).success).toBe(false);
  });
  it("keeps the created account after the requested role is assigned", async () => {
    const { client, deleteUser, insert } = fixture();
    await expect(provisionPortalUser(client, input)).resolves.toEqual({ id: "new-user" });
    expect(insert).toHaveBeenCalledWith({ user_id: "new-user", role: "client" });
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("removes the new auth account if assigning its role fails", async () => {
    const { client, deleteUser } = fixture({ message: "Role insert failed" });
    await expect(provisionPortalUser(client, input)).rejects.toThrow("new account was removed");
    expect(deleteUser).toHaveBeenCalledWith("new-user");
  });
  it("reports partial failure when account cleanup also fails", async () => {
    const { client } = fixture({ message: "Role insert failed" }, { message: "Auth unavailable" });
    await expect(provisionPortalUser(client, input)).rejects.toThrow("account cleanup failed");
  });
});
