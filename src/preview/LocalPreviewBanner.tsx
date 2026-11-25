import { useEffect, useState } from "react";
import { localPreviewRole, type LocalPreviewRole } from "./role";
import { OnlinePaymentPreview } from "./OnlinePaymentPreview";

export function LocalPreviewBanner() {
  const [role, setRole] = useState<LocalPreviewRole>("client");
  useEffect(() => setRole(localPreviewRole()), []);
  if (import.meta.env.MODE !== "client-preview") return null;
  return <aside aria-label="Local preview information" className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-stone-900">
    <p className="min-w-0"><strong>Local {role} preview.</strong> Sample data only. Changes reset on refresh.</p>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <a className="inline-flex min-h-11 items-center underline" href="/dashboard?previewRole=admin">Admin view</a>
      <a className="inline-flex min-h-11 items-center underline" href="/dashboard?previewRole=client">Client view</a>
      <button type="button" className="min-h-11 underline" onClick={() => window.location.reload()}>Reset sample data</button>
      <details><summary className="cursor-pointer py-3">Demo login</summary><p>{role === "admin" ? "admin@example.test / preview-admin" : "client@example.test / preview-client"}</p></details>
    </div>
    {role === "admin" && <details className="w-full"><summary className="w-fit cursor-pointer py-3">Payment demo</summary><OnlinePaymentPreview role={role} /></details>}
  </aside>;
}
