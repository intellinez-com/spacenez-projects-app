import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const [profileResult, roleResult] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", u.user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", u.user.id),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (roleResult.error) throw roleResult.error;
      const profile = profileResult.data;
      const roles = roleResult.data;
      const r = (roles ?? []).map((x) => x.role as string);
      return {
        id: u.user.id,
        email: u.user.email ?? null,
        full_name: profile?.full_name ?? null,
        roles: r,
        isAdmin: r.includes("admin"),
      };
    },
  });
}
