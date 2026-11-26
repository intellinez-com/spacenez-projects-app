import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ProjectStageAction =
  | { type: "add"; label: string }
  | { type: "rename"; key: string; label: string }
  | { type: "reorder"; keys: string[] }
  | { type: "archive"; key: string; move_to?: string };

export type ProjectStageResult = { version: number; stage_key?: string };
type StageRequest = { projectId: string; expectedVersion: number; requestId: string; action: ProjectStageAction };
type MutationError = { message: string; definite: boolean; saved: boolean; conflict: boolean };
type Options = {
  projectId: string | null;
  actorId: string | null;
  version: number;
  onReload?: (() => Promise<unknown>) | undefined;
  onSaved?: ((action: ProjectStageAction, result: ProjectStageResult) => void) | undefined;
};

type RequestState = { pending: StageRequest | null; result: ProjectStageResult | null; busy: boolean; error: MutationError | null };
const emptyState: RequestState = { pending: null, result: null, busy: false, error: null };
const requests = new Map<string, RequestState>();
const listeners = new Map<string, Set<() => void>>();
function setRequest(scope: string, state: RequestState | null) {
  if (state) requests.set(scope, state); else requests.delete(scope);
  listeners.get(scope)?.forEach((listener) => listener());
}

export function reorderProjectStages(keys: readonly string[], from: string, to: string): string[] {
  const source = keys.indexOf(from), destination = keys.indexOf(to);
  if (source < 0 || destination < 0 || source === destination) return [...keys];
  const next = [...keys];
  next.splice(source, 1);
  next.splice(destination, 0, from);
  return next;
}

/** A failed request keeps its exact payload and UUID until its outcome is known. */
export function useProjectStageMutations({ projectId, actorId, version, onReload, onSaved }: Options) {
  const scope = projectId && actorId ? `${actorId}:${projectId}` : "";
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const subscribe = useCallback((listener: () => void) => {
    if (!scope) return () => {};
    const callbacks = listeners.get(scope) ?? new Set<() => void>();
    callbacks.add(listener); listeners.set(scope, callbacks);
    return () => { callbacks.delete(listener); if (!callbacks.size) listeners.delete(scope); };
  }, [scope]);
  const read = useCallback(() => requests.get(scope) ?? emptyState, [scope]);
  const state = useSyncExternalStore(subscribe, read, () => emptyState);

  async function send(snapshot: StageRequest) {
    const stored = requests.get(scope);
    if (!scope || !stored || currentScope.current !== scope || projectId !== snapshot.projectId || stored.pending !== snapshot || stored.busy) return false;
    setRequest(scope, { ...stored, busy: true, error: null });
    try {
      let result = stored.result;
      if (!result) {
        const response = await supabase.rpc("mutate_project_stages", {
          p_project_id: snapshot.projectId,
          p_expected_version: snapshot.expectedVersion,
          p_request_id: snapshot.requestId,
          p_action: snapshot.action,
        });
        if (response.error) throw response.error;
        const data = response.data;
        if (!data || typeof data !== "object" || Array.isArray(data) || !("version" in data) || typeof data["version"] !== "number" || !Number.isSafeInteger(data["version"])) {
          throw new Error("The heading change could not be confirmed. Retry the same change.");
        }
        result = { version: data["version"], ...("stage_key" in data && typeof data["stage_key"] === "string" ? { stage_key: data["stage_key"] } : {}) };
        setRequest(scope, { pending: snapshot, result, busy: true, error: null });
      }
      await onReload?.();
      setRequest(scope, null);
      if (mounted.current && currentScope.current === scope) onSaved?.(snapshot.action, result);
      return true;
    } catch (failure) {
      const code = failure && typeof failure === "object" && "code" in failure ? String(failure.code) : "";
      const detail = failure && typeof failure === "object" && "message" in failure && typeof failure.message === "string" ? failure.message : "Check your connection and try again.";
      const confirmed = requests.get(scope)?.result ?? null;
      if (code === "40001" && !confirmed) {
        try { await onReload?.(); }
        catch { /* The project's own refresh warning remains available. */ }
        setRequest(scope, { pending: null, result: null, busy: false, error: { message: "Headings changed elsewhere. Review the refreshed headings before trying again.", definite: true, saved: false, conflict: true } });
      } else {
        const saved = !!confirmed;
        setRequest(scope, { pending: snapshot, result: confirmed, busy: false, error: {
          message: saved ? "The heading change was saved, but the project could not be refreshed. Retry refresh." : `The heading change could not be confirmed. ${detail}`,
          definite: !saved && ["22023", "42501", "23505", "23514"].includes(code),
          saved,
          conflict: false,
        } });
      }
      return false;
    }
  }

  function mutate(action: ProjectStageAction, expectedVersion = version) {
    const stored = requests.get(scope);
    if (!projectId || !scope || currentScope.current !== scope || stored?.busy || stored?.pending) return Promise.resolve(false);
    const snapshot: StageRequest = { projectId, expectedVersion, requestId: crypto.randomUUID(), action: JSON.parse(JSON.stringify(action)) as ProjectStageAction };
    setRequest(scope, { pending: snapshot, result: null, busy: false, error: null });
    return send(snapshot);
  }

  function discardRejected() {
    const stored = requests.get(scope);
    if (stored?.busy || !stored?.error?.definite) return;
    setRequest(scope, null);
  }

  function retry() { const pending = requests.get(scope)?.pending; return pending ? send(pending) : Promise.resolve(false); }
  function clearError() { const stored = requests.get(scope); if (!stored?.pending && !stored?.busy) setRequest(scope, null); }
  return { mutate, retry, discardRejected, busy: state.busy, pending: state.pending, error: state.error, clearError, disabled: !scope || state.busy || !!state.pending };
}

export type ProjectStageMutations = ReturnType<typeof useProjectStageMutations>;
