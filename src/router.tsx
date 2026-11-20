import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { PageLoading } from "./components/PageLoading";

export const getRouter = () => {
  // Supabase already retries safe database reads. A second retry loop here
  // multiplies that backoff and keeps failed screens waiting unnecessarily.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultPendingComponent: PageLoading,
    defaultPendingMs: 150,
    defaultPendingMinMs: 0,
  });

  return router;
};
