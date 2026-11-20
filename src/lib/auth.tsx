import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readPortalUser } from "@/lib/session";

export type Me = {
  id: string;
  email: string | null;
  full_name: string | null;
  roles: string[];
  isAdmin: boolean;
};

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async (): Promise<Me | null> => {
      const user = await readPortalUser();
      if (!user) return null;
      const [profileResult, roleResult] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (roleResult.error) throw roleResult.error;
      const profile = profileResult.data;
      const roles = roleResult.data;
      const r = (roles ?? []).map((x) => x.role as string);
      return {
        id: user.id,
        email: user.email ?? null,
        full_name: profile?.full_name ?? null,
        roles: r,
        isAdmin: r.includes("admin"),
      };
    },
  });
}
