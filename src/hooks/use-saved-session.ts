import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isMissingPortalSession, readPortalUser } from "@/lib/session";

/** Check returning visitors in the background without interrupting a new sign-in. */
export function useSavedSession({ enabled = true, onVerified }: { enabled?: boolean; onVerified: () => unknown }) {
  const [state, setState] = useState<"idle" | "checking" | "error">("idle");
  const [attempt, setAttempt] = useState(0);
  const canceled = useRef(false);
  const generation = useRef(0);
  const cancel = useCallback(() => {
    canceled.current = true;
    generation.current++;
    setState("idle");
  }, []);
  const retry = useCallback(() => {
    if (!canceled.current) setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    const isCurrent = () => active && !canceled.current && generation.current === current;
    if (!enabled || canceled.current) {
      setState("idle");
      return () => { active = false; };
    }
    setState("checking");
    void (async () => {
      try {
        // A cached session is only a hint. The existing user check verifies it.
        const { data, error } = await supabase.auth.getSession();
        if (!isCurrent()) return;
        if (error && !isMissingPortalSession(error)) throw error;
        if (error || !data.session) { setState("idle"); return; }
        const user = await readPortalUser();
        if (!isCurrent()) return;
        if (user) await onVerified();
        if (isCurrent()) setState("idle");
      } catch {
        if (isCurrent()) setState("error");
      }
    })();
    return () => { active = false; };
  }, [enabled, attempt, onVerified]);

  return { checking: enabled && state === "checking", error: enabled && state === "error", retry, cancel };
}
