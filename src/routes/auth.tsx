import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/BrandMark";
import { errorMessage } from "@/lib/errors";

export const Route = createFileRoute("/auth")({
  codeSplitGroupings: [],
  validateSearch: (search: Record<string, unknown>): { mode?: "forgot" } => search["mode"] === "forgot" ? { mode: "forgot" } : {},
  head: () => ({
    meta: [
      { title: "Sign in — Spacenez Track" },
      { name: "description", content: "Sign in to Spacenez Track to view your projects." },
      { property: "og:title", content: "Sign in — Spacenez Track" },
      { property: "og:description", content: "Sign in to view your Spacenez projects." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const mode = search.mode === "forgot" ? "forgot" : "signin";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "signin") {
        const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (result.error) throw result.error;
        await navigate({ to: "/dashboard" });
      } else {
        const result = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (result.error) throw result.error;
        setNotice("If an account matches this email, a reset link has been sent. Check your inbox and spam folder.");
        setPassword("");
        await navigate({ to: "/auth", search: {}, replace: true });
      }
    } catch (err) {
      setError(errorMessage(err, mode === "signin" ? "Could not sign in. Please try again." : "Could not request a reset link. Please try again."));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 py-6">
      <div className="w-full max-w-sm">
        <Link to="/" className="inline-block">
          <BrandMark className="h-10" alt="Spacenez Track" />
        </Link>
        <form onSubmit={submit} aria-busy={busy} aria-describedby={error ? "auth-error" : undefined} className="mt-8 space-y-4 rounded-xl border bg-card p-6 shadow-soft">
          <h1 className="text-2xl">{mode === "signin" ? "Welcome back" : "Reset password"}</h1>
          <p className="text-sm text-muted-foreground">
            Access is by invitation from the Spacenez team.
          </p>
          {error && <p id="auth-error" role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">{error}</p>}
          {notice && <p role="status" className="text-sm [overflow-wrap:anywhere]">{notice}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" inputMode="email" autoComplete={mode === "signin" ? "username" : "email"} autoCapitalize="none" spellCheck={false} required disabled={busy} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {mode === "signin" && (
            <div className="space-y-1.5">
              <Label htmlFor="pw">Password</Label>
              <Input id="pw" name="password" type="password" autoComplete="current-password" required disabled={busy} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? mode === "signin" ? "Signing in…" : "Sending reset link…" : mode === "signin" ? "Sign in" : "Send reset link"}
          </Button>
          <button
            type="button"
            disabled={busy}
            className="min-h-11 w-full text-center text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            onClick={() => {
              setError(""); setNotice(""); setPassword("");
              void navigate({ to: "/auth", search: mode === "signin" ? { mode: "forgot" } : {}, replace: true }).catch((err: unknown) => setError(errorMessage(err, "Could not open this form. Please try again.")));
            }}
          >
            {mode === "signin" ? "Forgot password?" : "Back to sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
