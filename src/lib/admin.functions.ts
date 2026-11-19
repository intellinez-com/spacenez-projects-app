import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { portalUserInput } from "@/lib/portal-user-input";

export const createPortalUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => portalUserInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleCheckError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleCheckError) throw new Error("Could not verify admin access. Please retry.");
    if (!isAdmin) throw new Error("Only admins can add users");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { provisionPortalUser } = await import("@/lib/provision-user.server");
    return provisionPortalUser(supabaseAdmin, data);
  });
