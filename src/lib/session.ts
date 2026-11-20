import { isAuthApiError, isAuthSessionMissingError, type User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** An unavailable auth service is not evidence that the visitor signed out. */
export function isMissingPortalSession(error: unknown): boolean {
  if (isAuthSessionMissingError(error)) return true;
  return isAuthApiError(error) && (error.status === 401 || [
    "session_not_found", "user_not_found", "bad_jwt", "refresh_token_not_found",
  ].includes(error.code ?? ""));
}

export async function readPortalUser(): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    if (isMissingPortalSession(error)) return null;
    throw error;
  }
  return data.user;
}
