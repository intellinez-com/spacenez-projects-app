export type LocalPreviewRole = "client" | "admin";

/** Session-only demo choice; this module never grants access to the real backend. */
export function localPreviewRole(): LocalPreviewRole {
  if (import.meta.env.MODE !== "client-preview" || typeof window === "undefined") return "client";
  const choice = new URLSearchParams(window.location.search).get("previewRole");
  try {
    if (choice === "admin" || choice === "client") {
      window.sessionStorage.setItem("spacenez-local-preview-role", choice);
      return choice;
    }
    return window.sessionStorage.getItem("spacenez-local-preview-role") === "admin" ? "admin" : "client";
  } catch { return choice === "admin" ? "admin" : "client"; }
}
