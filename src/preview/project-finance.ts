// Aliased only by the explicit serve-only preview plugin. Production keeps signed URLs.
export * from "../lib/project-finance";
import { assertFinanceProofPath } from "../lib/project-finance";
import { localFinanceProof } from "./client";

export async function openFinanceProof(projectId: string, path: string): Promise<void> {
  assertFinanceProofPath(projectId, path);
  const blob = localFinanceProof(projectId, path);
  const url = URL.createObjectURL(blob);
  const popup = window.open(url, "_blank");
  if (!popup) {
    URL.revokeObjectURL(url);
    throw new Error("Allow pop-ups to open the sample payment proof.");
  }
  popup.opener = null;
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
