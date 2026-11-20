import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { createPortalUser } from "@/lib/admin.functions";
import { useMe } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/people")({
  head: () => ({ meta: [{ title: "People — Spacenez Track" }] }),
  component: People,
});

function People() {
  const { data: me, isPending: mePending, error: meError, refetch: retryMe } = useMe();
  const qc = useQueryClient();
  const create = useServerFn(createPortalUser);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["people"],
    enabled: !!me?.isAdmin,
    queryFn: async () => {
      const [profileResult, roleResult] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at"),
        supabase.from("user_roles").select("*"),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (roleResult.error) throw roleResult.error;
      const profiles = profileResult.data;
      const roles = roleResult.data;
      return (profiles ?? []).map((p) => ({ ...p, roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role) }));
    },
  });
  const [form, setForm] = useState({ email: "", full_name: "", company: "", password: "", role: "client" as "admin" | "partner" | "client" });
  const [busy, setBusy] = useState(false);

  if (mePending) return <p className="p-8 text-muted-foreground">Loading access…</p>;
  if (meError) return <div className="space-y-3 p-8"><p role="alert">{errorMessage(meError, "Could not load your access.")}</p><Button onClick={() => void retryMe()}>Retry</Button></div>;
  if (!me?.isAdmin) return <p className="p-8 text-muted-foreground">Only Spacenez admins can manage people.</p>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await create({ data: form });
      toast.success(`Added ${form.email}. Share the temporary password with them.`);
      setForm({ email: "", full_name: "", company: "", password: "", role: "client" });
      qc.invalidateQueries({ queryKey: ["people"] });
    } catch (err) {
      toast.error(errorMessage(err, "Person could not be added."));
      qc.invalidateQueries({ queryKey: ["people"] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto min-w-0 max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <p className="eyebrow">Access</p>
      <h1 className="mt-1 text-3xl sm:text-4xl">People</h1>
      <div className="mt-6 grid min-w-0 gap-6 sm:mt-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div role="region" aria-label="People list" tabIndex={0} className="min-w-0 overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr><th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Company</th><th className="p-3">Role</th></tr>
            </thead>
            <tbody>
              {isPending && <tr><td colSpan={4} className="p-3 text-muted-foreground">Loading people…</td></tr>}
              {error && <tr><td colSpan={4} className="p-3"><p role="alert" className="text-destructive">{errorMessage(error, "People could not be loaded.")}</p><Button size="sm" variant="outline" onClick={() => void refetch()}>Retry</Button></td></tr>}
              {!error && data?.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="max-w-48 p-3 font-medium [overflow-wrap:anywhere]">{p.full_name}</td>
                  <td className="max-w-60 p-3 text-muted-foreground [overflow-wrap:anywhere]">{p.email}</td>
                  <td className="max-w-48 p-3 text-muted-foreground [overflow-wrap:anywhere]">{p.company}</td>
                  <td className="p-3 capitalize">{p.roles.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={submit} className="min-w-0 space-y-3 rounded-xl border bg-card p-4 shadow-soft sm:p-5">
          <h2 className="flex items-center gap-2 text-xl"><UserPlus className="h-5 w-5" /> Add person</h2>
          <div className="min-w-0 space-y-1.5"><Label htmlFor="person-full-name">Full name</Label><Input id="person-full-name" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
          <div className="min-w-0 space-y-1.5"><Label htmlFor="person-email">Email</Label><Input id="person-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="min-w-0 space-y-1.5"><Label htmlFor="person-company">Company</Label><Input id="person-company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as typeof form.role })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="client">Client</SelectItem>
                <SelectItem value="partner">Partner</SelectItem>
                <SelectItem value="admin">Admin (Spacenez team)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="person-password">Temporary password</Label><Input id="person-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <Button type="submit" className="w-full" disabled={busy}>Add person</Button>
          <p className="text-xs text-muted-foreground">Then open a project's Team tab to give them access.</p>
        </form>
      </div>
    </div>
  );
}
