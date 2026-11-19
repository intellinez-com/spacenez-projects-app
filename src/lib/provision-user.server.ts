import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { PortalUserInput } from "@/lib/portal-user-input";
import { errorMessage } from "@/lib/errors";

/** Called only after the server has checked the caller's admin role. */
export async function provisionPortalUser(admin: SupabaseClient<Database>, input: PortalUserInput) {
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email, password: input.password, email_confirm: true,
    user_metadata: { full_name: input.full_name, company: input.company || null },
  });
  if (error) throw error;
  if (!data.user) throw new Error("Could not create user.");
  const id = data.user.id;
  try {
    const { error: clearError } = await admin.from("user_roles").delete().eq("user_id", id);
    if (clearError) throw clearError;
    const { error: roleError } = await admin.from("user_roles").insert({ user_id: id, role: input.role });
    if (roleError) throw roleError;
  } catch (roleFailure) {
    try {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(id);
      if (cleanupError) throw cleanupError;
    } catch {
      throw new Error(`Role setup failed and account cleanup failed. An admin must repair or remove account ${id} before retrying.`);
    }
    throw new Error(`Role setup failed: ${errorMessage(roleFailure)} The new account was removed; you can retry.`);
  }
  return { id };
}
