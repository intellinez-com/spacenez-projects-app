import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { FinanceBundle } from "@/lib/project-finance";
import { previewIds } from "./fixtures";
import type { LocalPreviewRole } from "./role";

function money(paise: number) {
  const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.floor(paise / 100));
  return `₹${rupees}.${String(paise % 100).padStart(2, "0")}`;
}

/** A local walkthrough only. It is never a payment entry point in the live portal. */
export function OnlinePaymentPreview({ role }: { role: LocalPreviewRole }) {
  if (import.meta.env.MODE !== "client-preview" || role !== "admin") return null;
  return <LocalOnlinePaymentPreview />;
}

function LocalOnlinePaymentPreview() {
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<"client" | "checkout">("client");
  const query = useQuery<FinanceBundle>({
    queryKey: ["project-finance", previewIds.project],
    enabled: open,
    queryFn: async () => {
      // Import the closed demo transport directly; this never falls back to a live SDK.
      const { supabase } = await import("./client");
      const { data, error } = await supabase.rpc("get_project_finance", { p_project_id: previewIds.project });
      if (error) throw error;
      const { parseProjectFinanceBundle } = await import("../lib/project-finance");
      return parseProjectFinanceBundle(data, previewIds.project);
    },
  });
  const finance = query.data;
  const plan = finance?.configured ? finance.plan : null;
  const summary = finance?.configured ? finance.summary : null;
  return <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3 border-t border-amber-300 pt-3">
    <div className="min-w-0"><p className="font-medium">Online payments preview</p><p>Review a fictional client payment screen and checkout.</p></div>
    <Button type="button" variant="outline" className="min-h-11 max-w-full whitespace-normal" onClick={() => { setScreen("client"); setOpen(true); }}>Review client payment screen</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] min-w-0 overflow-y-auto [overflow-wrap:anywhere]">
        <DialogHeader>
          <DialogTitle>{screen === "client" ? "Client payment preview" : "Demo checkout"}</DialogTitle>
          <DialogDescription>{screen === "client" ? "Fictional client screen for the sample interior project." : "No payment gateway connected. No payment taken."}</DialogDescription>
        </DialogHeader>
        {query.isError ? <div role="alert" className="space-y-3 text-sm"><p>The sample payment details could not be loaded.</p><Button type="button" variant="outline" onClick={() => void query.refetch()}>Retry sample details</Button></div>
          : !finance ? <p role="status" className="text-sm">Loading sample balance…</p>
          : !plan || !summary ? <p className="text-sm">Set up the sample project’s agreed amount and milestones first. No client payment is available yet.</p>
          : screen === "client" ? <>
            <div className="space-y-1"><h3 className="text-base font-medium">Sample interior project</h3>{plan.quote_label && <p className="text-sm text-muted-foreground">{plan.quote_label}</p>}</div>
            <dl className="grid min-w-0 grid-cols-2 gap-4 text-sm">
              {[["Agreed project amount", plan.total_minor], ["Confirmed paid", summary.net_received_minor], ["Amount due now", summary.due_now_minor], ["Remaining balance", summary.outstanding_minor]].map(([label, amount]) => <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 text-lg tabular-nums">{money(amount as number)}</dd></div>)}
            </dl>
            <p className="text-sm">Pay the amount due through the connected provider’s checkout. Your project balance updates after the payment is verified.</p>
            <p className="border-t pt-3 text-sm text-muted-foreground">Demo only. Spacenez has not connected a payment gateway. This button shows the next screen without taking payment.</p>
            <Button type="button" className="min-h-11 w-full" disabled={summary.due_now_minor <= 0 || query.isFetching} onClick={() => setScreen("checkout")}>Pay online</Button>
            {summary.due_now_minor <= 0 && <p className="text-sm text-muted-foreground">Nothing is due now.</p>}
          </> : <>
            <dl className="text-sm"><dt className="text-muted-foreground">Demo checkout amount</dt><dd className="mt-1 text-2xl tabular-nums">{money(summary.due_now_minor)}</dd></dl>
            <p className="text-sm">The client would choose a supported payment method on the provider’s hosted checkout.</p>
            <p className="text-sm">Spacenez first creates a gateway account and payment link. We then connect checkout and verify successful payments before updating the project balance.</p>
            <p className="border-t pt-3 text-sm font-medium">Preview only. The amount has not been marked paid.</p>
            <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => setScreen("client")}>Back to payment screen</Button><Button type="button" className="min-h-11 w-full sm:w-auto" onClick={() => setOpen(false)}>Close preview</Button></div>
          </>}
      </DialogContent>
    </Dialog>
  </div>;
}
