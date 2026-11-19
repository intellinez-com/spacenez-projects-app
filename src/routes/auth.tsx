import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/BrandMark";

export const Route = createFileRoute("/auth")({
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
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (error) { toast.error(error.message); return; }
      navigate({ to: "/dashboard" });
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setBusy(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Check your email for a reset link.");
      setMode("signin");
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="inline-block">
          <BrandMark className="h-10" alt="Spacenez Track" />
        </Link>
        <form onSubmit={submit} className="mt-8 space-y-4 rounded-xl border bg-card p-6 shadow-soft">
          <h1 className="text-2xl">{mode === "signin" ? "Welcome back" : "Reset password"}</h1>
          <p className="text-sm text-muted-foreground">
            Access is by invitation from the Spacenez team.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {mode === "signin" && (
            <div className="space-y-1.5">
              <Label htmlFor="pw">Password</Label>
              <Input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {mode === "signin" ? "Sign in" : "Send reset link"}
          </Button>
          <button
            type="button"
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setMode(mode === "signin" ? "forgot" : "signin")}
          >
            {mode === "signin" ? "Forgot password?" : "Back to sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
