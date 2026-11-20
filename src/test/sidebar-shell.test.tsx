import type { ComponentProps, ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signOut: vi.fn(), navigate: vi.fn(), admin: true }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { signOut: mocks.signOut } } }));
vi.mock("@/lib/session", () => ({ readPortalUser: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useMe: () => ({ data: {
  id: "viewer", full_name: "Sample User", email: "sample@example.test", isAdmin: mocks.admin,
  roles: [mocks.admin ? "admin" : "client"],
}, refetch: vi.fn() }) }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Outlet: () => <div>Project workspace</div>,
  redirect: vi.fn(), useNavigate: () => mocks.navigate, useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ to, activeProps: _active, ...props }: { to: string; activeProps?: unknown } & ComponentProps<"a">) => <a href={to} {...props} />,
}));

import { Route } from "@/routes/_authenticated/route";
const Shell = Route.options.component as ComponentType;
const clients: QueryClient[] = [];

beforeEach(() => {
  vi.resetAllMocks(); mocks.admin = true;
  window.localStorage.clear();
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.navigate.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.restoreAllMocks(); });

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const view = render(<QueryClientProvider client={client}><Shell /></QueryClientProvider>);
  return { ...view, client, sidebar: within(screen.getByRole("complementary", { name: "Sidebar" })) };
}

describe("Persistent sidebar navigation", () => {
  it("collapses into accessible icons, retains account/sign-out access and restores the preference", () => {
    const first = renderShell();
    expect(first.sidebar.getByRole("img", { name: "Spacenez Track" })).toHaveAttribute("src", "/branding/spacenez-logo-light.png");
    const toggle = first.sidebar.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(first.sidebar.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
    expect(first.sidebar.getByRole("img", { name: "Spacenez Track" })).toHaveAttribute("src", "/branding/spacenez-mark-light.png");
    expect(first.sidebar.getByRole("link", { name: "Projects" })).toHaveAttribute("title", "Projects");
    expect(first.sidebar.getByRole("link", { name: "People" })).toHaveAttribute("title", "People");
    expect(first.sidebar.getByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(first.sidebar.getByText("Sample User · admin")).toBeInTheDocument();
    expect(window.localStorage.getItem("spacenez-sidebar-collapsed")).toBe("true");
    first.unmount();
    const restored = renderShell();
    fireEvent.click(restored.sidebar.getByRole("button", { name: "Expand sidebar" }));
    expect(restored.sidebar.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
    expect(window.localStorage.getItem("spacenez-sidebar-collapsed")).toBe("false");
  });

  it("keeps People hidden for client accounts in either sidebar mode", () => {
    mocks.admin = false;
    window.localStorage.setItem("spacenez-sidebar-collapsed", "true");
    const { sidebar } = renderShell();
    expect(sidebar.queryByRole("link", { name: "People" })).not.toBeInTheDocument();
    fireEvent.click(sidebar.getByRole("button", { name: "Expand sidebar" }));
    expect(sidebar.queryByRole("link", { name: "People" })).not.toBeInTheDocument();
    expect(sidebar.getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/dashboard");
  });

  it.each(["read", "write"])("keeps the toggle usable when preference storage blocks %s", (operation) => {
    if (operation === "read") vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("Blocked storage", "SecurityError"); });
    else vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Blocked storage", "SecurityError"); });
    const { sidebar } = renderShell();
    fireEvent.click(sidebar.getByRole("button", { name: "Collapse sidebar" }));
    expect(sidebar.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(sidebar.getByRole("link", { name: "Projects" })).toBeInTheDocument();
    fireEvent.click(sidebar.getByRole("button", { name: "Expand sidebar" }));
    expect(sidebar.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
  });

  it("prevents duplicate sign-out and retains a retry path after failure", async () => {
    let finish!: (value: { error: { message: string } }) => void;
    mocks.signOut.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { sidebar, client } = renderShell();
    client.setQueryData(["project", "sample"], { name: "Existing project" });
    const button = sidebar.getByRole("button", { name: "Sign out" });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    expect(sidebar.getByRole("button", { name: "Signing out…" })).toBeDisabled();
    await act(async () => { finish({ error: { message: "Connection unavailable" } }); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection unavailable");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(client.getQueryData(["project", "sample"])).toEqual({ name: "Existing project" });
    fireEvent.click(sidebar.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/auth", replace: true }));
    expect(mocks.signOut).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(["project", "sample"])).toBeUndefined();
  });
});
