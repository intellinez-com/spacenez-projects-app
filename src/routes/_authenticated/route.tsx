import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { LayoutGrid, Users, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { readPortalUser } from "@/lib/session";
import { errorMessage } from "@/lib/errors";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  codeSplitGroupings: [["component"]],
  pendingMs: 150,
  pendingMinMs: 0,
  pendingComponent: SessionPending,
  errorComponent: SessionError,
  beforeLoad: async () => {
    if (!await readPortalUser()) throw redirect({ to: "/auth" });
  },
  component: Shell,
});

function SessionPending() {
  return <div role="status" aria-live="polite" className="mx-auto max-w-xl px-4 py-12 text-sm text-muted-foreground">Checking your sign-in…</div>;
}

function SessionError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  return <div className="mx-auto max-w-xl space-y-4 px-4 py-12">
    <h1 className="text-2xl">We couldn’t check your sign-in</h1>
    <p role="alert" className="text-sm text-muted-foreground">Check your connection and try again. You can also return to the sign-in page.</p>
    <div className="flex flex-wrap gap-2"><Button onClick={() => { reset(); void router.invalidate(); }}>Try again</Button><Button asChild variant="outline"><Link to="/auth">Go to sign in</Link></Button></div>
  </div>;
}

function Shell() {
  const { data: me, error: accountError, refetch: reloadAccount } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const leaving = useRef(false);

  async function signOut() {
    if (leaving.current) return;
    leaving.current = true; setSigningOut(true); setSignOutError("");
    try {
      await qc.cancelQueries();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      qc.clear();
      await navigate({ to: "/auth", replace: true });
    } catch (error) { setSignOutError(errorMessage(error, "Sign out failed. Please try again.")); }
    finally { leaving.current = false; setSigningOut(false); }
  }

  const nav = "flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
  const active = { className: "bg-sidebar-accent text-sidebar-accent-foreground" };

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar p-4 lg:flex">
        <Link to="/dashboard" className="px-3 py-2">
          <BrandMark variant="full-light" className="h-9" alt="Spacenez Track" />
        </Link>
        <nav className="mt-6 space-y-1">
          <Link to="/dashboard" className={nav} activeProps={active}>
            <LayoutGrid className="h-4 w-4" /> Projects
          </Link>
          {me?.isAdmin && (
            <Link to="/people" className={nav} activeProps={active}>
              <Users className="h-4 w-4" /> People
            </Link>
          )}
        </nav>
        <div className="mt-auto border-t border-sidebar-border pt-4">
          <p className="truncate px-3 text-sm text-sidebar-accent-foreground">{me?.full_name ?? me?.email}</p>
          <p className="px-3 text-xs capitalize text-sidebar-foreground/60">{me?.roles.join(", ") || "member"}</p>
          <button disabled={signingOut} onClick={() => void signOut()} className={`${nav} mt-2 w-full disabled:opacity-50`}>
            <LogOut className="h-4 w-4" /> {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-x-4 border-b bg-card px-4 py-2 lg:hidden">
          <Link to="/dashboard" aria-label="Spacenez projects" className="flex min-h-11 items-center"><BrandMark className="h-6 max-w-full" alt="Spacenez Track" /></Link>
          <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-1 text-sm">
            <Link to="/dashboard" className="flex min-h-11 items-center rounded-md px-2 hover:bg-muted" activeProps={{ className: "bg-muted" }}>Projects</Link>
            {me?.isAdmin && <Link to="/people" className="flex min-h-11 items-center rounded-md px-2 hover:bg-muted" activeProps={{ className: "bg-muted" }}>People</Link>}
            <button disabled={signingOut} onClick={() => void signOut()} className="min-h-11 rounded-md px-2 hover:bg-muted disabled:opacity-50">{signingOut ? "Signing out…" : "Sign out"}</button>
          </nav>
        </header>
        <main className="min-w-0 flex-1">
          {signOutError && <p role="alert" className="border-b px-4 py-3 text-sm text-destructive">{signOutError}</p>}
          {accountError ? <div role="alert" className="mx-auto max-w-xl space-y-3 px-4 py-8"><p>Your account details could not be loaded. Please retry to check your project permissions.</p><Button onClick={() => void reloadAccount()}>Retry account details</Button></div> : <Outlet />}
        </main>
      </div>
    </div>
  );
}
