import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createAuthQueryCacheObserver } from "@/lib/auth-query-cache";

describe("authentication query-cache isolation", () => {
  it("preserves queries already built for the initial session and repeated same-user sign-ins", () => {
    const client = new QueryClient();
    client.setQueryData(["me"], { id: "client-a" });
    client.setQueryData(["project", "a"], { name: "Client A project" });
    const invalidateRouter = vi.fn();
    const observer = createAuthQueryCacheObserver(client, invalidateRouter);
    observer("INITIAL_SESSION", { user: { id: "client-a" } });
    expect(invalidateRouter).not.toHaveBeenCalled();
    observer("SIGNED_IN", { user: { id: "client-a" } });
    expect(client.getQueryData(["project", "a"])).toEqual({ name: "Client A project" });
    expect(invalidateRouter).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it("clears all private queries on sign-out from any source before invalidating routes", () => {
    const client = new QueryClient();
    client.setQueryData(["me"], { id: "client-a" });
    client.setQueryData(["projects"], ["Private project"]);
    client.setQueryData(["comments", "a"], ["Private comment"]);
    const resetMountedViews = vi.fn(() => expect(client.getQueryCache().getAll()).toHaveLength(0));
    const invalidateRouter = vi.fn(() => {
      expect(client.getQueryCache().getAll()).toHaveLength(0);
      expect(resetMountedViews).toHaveBeenCalledOnce();
    });
    createAuthQueryCacheObserver(client, invalidateRouter, resetMountedViews)("SIGNED_OUT", null);
    expect(invalidateRouter).toHaveBeenCalledOnce();
  });

  it("cancels an old account's in-flight query without clearing the new account's fresh data", async () => {
    const client = new QueryClient();
    let completeOldQuery!: (value: string[]) => void;
    const oldResult = new Promise<string[]>((resolve) => { completeOldQuery = resolve; });
    const oldRequest = client.fetchQuery({ queryKey: ["projects"], queryFn: () => oldResult }).catch(() => undefined);
    const observer = createAuthQueryCacheObserver(client, () => {
      expect(client.getQueryCache().getAll()).toHaveLength(0);
      client.setQueryData(["me"], { id: "client-b" });
      client.setQueryData(["projects"], ["Client B project"]);
    });
    observer("INITIAL_SESSION", { user: { id: "client-a" } });
    observer("SIGNED_IN", { user: { id: "client-b" } });
    completeOldQuery(["Client A private project"]);
    await oldRequest;
    expect(client.getQueryData(["projects"])).toEqual(["Client B project"]);
    expect(client.getQueryData(["me"])).toEqual({ id: "client-b" });
    client.clear();
  });

  it("detects a different initial identity when cached user data already exists", () => {
    const client = new QueryClient();
    client.setQueryData(["me"], { id: "client-a" });
    client.setQueryData(["projects"], ["Client A project"]);
    const observer = createAuthQueryCacheObserver(client, vi.fn());
    observer("INITIAL_SESSION", { user: { id: "client-b" } });
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it("clears private queries if initial session restoration finds no authenticated user", () => {
    const client = new QueryClient();
    client.setQueryData(["me"], null);
    client.setQueryData(["projects"], ["Expired account's project"]);
    createAuthQueryCacheObserver(client, vi.fn())("INITIAL_SESSION", null);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it("invalidates same-user profile updates without discarding that user's cache", () => {
    const client = new QueryClient();
    client.setQueryData(["me"], { id: "client-a" });
    client.setQueryData(["projects"], ["Client A project"]);
    const observer = createAuthQueryCacheObserver(client, vi.fn());
    observer("USER_UPDATED", { user: { id: "client-a" } });
    expect(client.getQueryData(["projects"])).toEqual(["Client A project"]);
    expect(client.getQueryState(["projects"])?.isInvalidated).toBe(true);
    client.clear();
  });
});
