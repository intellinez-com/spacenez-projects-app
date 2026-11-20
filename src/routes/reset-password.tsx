import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/BrandMark";
import { errorMessage } from "@/lib/errors";
import { isMissingPortalSession, readPortalUser } from "@/lib/session";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — Spacenez Track" },
      { name: "description", content: "Choose a new password for Spacenez Track." },
      { property: "og:title", content: "Reset password — Spacenez Track" },
      { property: "og:description", content: "Choose a new password." },
    ],
  }),
  component: ResetPage,
});

function ResetPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [sessionState, setSessionState] = useState<"checking" | "ready" | "missing" | "error">("checking");
  const [checkError, setCheckError] = useState("");
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setSessionState("checking");
    setCheckError("");
    void (async () => {
      try {
        const user = await readPortalUser();
        if (!active) return;
        setAccountEmail(user?.email ?? null);
        setSessionState(user ? "ready" : "missing");
      } catch (err) {
        if (!active) return;
        setCheckError(errorMessage(err, "Check your connection and try again."));
        setSessionState("error");
      }
    })();
    return () => { active = false; };
  }, [attempt]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current || sessionState !== "ready" || saved) return;
    setError("");
    if (password !== confirmation) { setError("Passwords do not match. Enter the same new password in both fields."); return; }
    submitting.current = true;
    setBusy(true);
    try {
      const result = await supabase.auth.updateUser({ password });
      if (result.error) throw result.error;
      setSaved(true);
      setPassword(""); setConfirmation("");
    } catch (err) {
      if (isMissingPortalSession(err)) {
        setSessionState("missing");
        setPassword(""); setConfirmation("");
      } else {
        setError(errorMessage(err, "Could not update your password. Please try again."));
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 py-6">
      <div className="w-full max-w-sm">
        <BrandMark className="h-9" alt="Spacenez Track" />
        <section className="mt-8 space-y-4 rounded-xl border bg-card p-6 shadow-soft">
          <h1 className="text-2xl">Set a new password</h1>
          {sessionState === "checking" && <p role="status" className="text-sm text-muted-foreground">Checking your account…</p>}
          {sessionState === "error" && <>
            <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">We could not verify your account. {checkError}</p>
            <Button className="w-full" variant="outline" onClick={() => { setSessionState("checking"); setAttempt((value) => value + 1); }}>Try again</Button>
          </>}
          {sessionState === "missing" && <>
            <p role="alert" className="text-sm">There is no active sign-in or valid reset link. Open the latest link from your email, or request a new one.</p>
            <Button asChild className="w-full"><Link to="/auth" search={{ mode: "forgot" }}>Request a new reset link</Link></Button>
            <Link to="/auth" search={{}} className="flex min-h-11 items-center justify-center text-sm text-muted-foreground hover:text-foreground">Back to sign in</Link>
          </>}
          {sessionState === "ready" && (saved ? <>
            <p role="status" className="text-sm">Your password has been updated.</p>
            <Button asChild className="w-full"><Link to="/dashboard">Continue to projects</Link></Button>
          </> : <form onSubmit={submit} aria-busy={busy} aria-describedby={error ? "reset-error" : "password-help"} className="space-y-4">
            {accountEmail && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">For {accountEmail}</p>}
            {error && <p id="reset-error" role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">{error}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="pw">New password</Label>
              <Input id="pw" name="new-password" type="password" autoComplete="new-password" minLength={8} required disabled={busy} value={password} onChange={(e) => setPassword(e.target.value)} />
              <p id="password-help" className="text-xs text-muted-foreground">Use at least 8 characters.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-pw">Confirm new password</Label>
              <Input id="confirm-pw" name="confirm-password" type="password" autoComplete="new-password" minLength={8} required disabled={busy} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving password…" : "Save password"}</Button>
          </form>)}
        </section>
      </div>
    </div>
  );
}
