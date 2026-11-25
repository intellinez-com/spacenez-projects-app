import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { LayoutGrid, Users, LogOut, PanelLeftClose, PanelLeftOpen, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { readPortalUser } from "@/lib/session";
import { errorMessage } from "@/lib/errors";
import { safeAuthReturnTo } from "@/lib/auth-return";

const SIDEBAR_PREFERENCE = "spacenez-sidebar-collapsed";

function savedSidebarPreference() {
  try { return typeof window !== "undefined" && window.localStorage.getItem(SIDEBAR_PREFERENCE) === "true"; }
  catch { return false; }
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  codeSplitGroupings: [["component"]],
  pendingMs: 150,
  pendingMinMs: 0,
  pendingComponent: SessionPending,
  errorComponent: SessionError,
  beforeLoad: async ({ location }) => {
    if (!await readPortalUser()) {
      const returnTo = safeAuthReturnTo(location.pathname);
      throw redirect({ to: "/auth", search: returnTo ? { returnTo } : {} });
    }
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
  const [collapsed, setCollapsed] = useState(savedSidebarPreference);
  const leaving = useRef(false);

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try { window.localStorage.setItem(SIDEBAR_PREFERENCE, String(next)); }
    catch { /* Navigation still works when the browser blocks saved preferences. */ }
  }

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

  const nav = "flex min-h-11 items-center gap-2 rounded-md py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring";
  const active = { className: "bg-sidebar-accent text-sidebar-accent-foreground" };
  const accountName = me?.full_name || me?.email || "Your account";
  const accountRoles = me?.roles.join(", ") || "member";
  const accountLabel = `${accountName} · ${accountRoles}`;
  const compactNav = collapsed ? "justify-center px-0" : "px-3";

  return (
    <div className="flex min-h-dvh">
      <aside aria-label="Sidebar" className={`sticky top-0 hidden h-dvh min-h-0 shrink-0 self-start flex-col overflow-hidden bg-sidebar p-3 lg:flex ${collapsed ? "w-[72px]" : "w-60"}`}>
        <div className={`flex shrink-0 items-center ${collapsed ? "flex-col gap-1" : "justify-between gap-2"}`}>
          <Link to="/dashboard" aria-label="Spacenez projects" className={`flex min-h-11 min-w-0 items-center ${collapsed ? "justify-center" : "flex-1"}`}>
            <BrandMark variant={collapsed ? "mark-light" : "full-light"} className="h-9 max-w-full" alt="Spacenez Track" />
          </Link>
          <button type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} aria-controls="desktop-sidebar-navigation" onClick={toggleSidebar} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring">
            {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
        <nav id="desktop-sidebar-navigation" aria-label="Desktop navigation" className="mt-6 min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain">
          <Link to="/dashboard" aria-label="Projects" title={collapsed ? "Projects" : undefined} className={`${nav} ${compactNav}`} activeProps={active}>
            <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden="true" /><span className={collapsed ? "sr-only" : undefined}>Projects</span>
          </Link>
          {me?.isAdmin && (
            <Link to="/people" aria-label="People" title={collapsed ? "People" : undefined} className={`${nav} ${compactNav}`} activeProps={active}>
              <Users className="h-4 w-4 shrink-0" aria-hidden="true" /><span className={collapsed ? "sr-only" : undefined}>People</span>
            </Link>
          )}
        </nav>
        <div className="mt-4 shrink-0 border-t border-sidebar-border pt-3">
          {collapsed ? <div title={accountLabel} className="flex min-h-11 items-center justify-center text-sidebar-foreground/80"><UserRound className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{accountLabel}</span></div> : <>
            <p className="truncate px-3 text-sm text-sidebar-accent-foreground" title={accountName}>{accountName}</p>
            <p className="px-3 text-xs capitalize text-sidebar-foreground/60">{accountRoles}</p>
          </>}
          <button type="button" aria-label={signingOut ? "Signing out…" : "Sign out"} title={collapsed ? signingOut ? "Signing out…" : "Sign out" : undefined} disabled={signingOut} onClick={() => void signOut()} className={`${nav} ${compactNav} mt-2 w-full disabled:opacity-50`}>
            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" /><span className={collapsed ? "sr-only" : undefined}>{signingOut ? "Signing out…" : "Sign out"}</span>
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-x-4 border-b bg-card px-4 py-2 lg:hidden">
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
