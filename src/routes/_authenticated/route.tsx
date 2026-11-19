import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, Users, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { BrandMark } from "@/components/BrandMark";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: Shell,
});

function Shell() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const nav = "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
  const active = { className: "bg-sidebar-accent text-sidebar-accent-foreground" };

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar p-4 md:flex">
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
          <button onClick={signOut} className={`${nav} mt-2 w-full`}>
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-card px-4 py-3 md:hidden">
          <Link to="/dashboard"><BrandMark className="h-6" alt="Spacenez Track" /></Link>
          <div className="flex gap-3 text-sm">
            {me?.isAdmin && <Link to="/people">People</Link>}
            <button onClick={signOut}>Sign out</button>
          </div>
        </header>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
