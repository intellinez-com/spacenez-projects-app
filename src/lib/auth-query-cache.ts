import type { AuthChangeEvent } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";

/** Keep the browser's shared query cache within a single authenticated identity. */
export function createAuthQueryCacheObserver(queryClient: QueryClient, invalidateRouter: () => unknown, resetMountedViews: () => void = () => {}) {
  const cachedUser = queryClient.getQueryData<{ id: string } | null>(["me"]);
  let userId: string | null | undefined = cachedUser?.id;

  return (event: AuthChangeEvent, session: { user: { id: string } } | null) => {
    const nextUserId = session?.user.id ?? null;
    const identityChanged = userId !== undefined && userId !== nextUserId;
    userId = nextUserId;

    if (event === "SIGNED_OUT" || identityChanged || (event === "INITIAL_SESSION" && nextUserId === null)) {
      // Cancellation starts synchronously. Clear before routing/refetching so a
      // later cancellation promise cannot erase data fetched by the new user.
      void queryClient.cancelQueries();
      queryClient.clear();
      resetMountedViews();
      void invalidateRouter();
      return;
    }

    // INITIAL_SESSION establishes the identity without discarding queries that
    // were already started for that session during the first render.
    if (event === "SIGNED_IN" || event === "USER_UPDATED") {
      void invalidateRouter();
      void queryClient.invalidateQueries();
    }
  };
}
