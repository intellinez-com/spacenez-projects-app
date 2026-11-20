import { type ComponentType, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(), requestReset: vi.fn(), updateUser: vi.fn(), readUser: vi.fn(), getSession: vi.fn(), signOut: vi.fn(), navigate: vi.fn(),
  search: {} as { mode?: "forgot" },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { signInWithPassword: mocks.signIn, resetPasswordForEmail: mocks.requestReset, updateUser: mocks.updateUser, getSession: mocks.getSession, signOut: mocks.signOut } } }));
vi.mock("@/lib/session", () => ({
  readPortalUser: mocks.readUser,
  isMissingPortalSession: (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "session_not_found",
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => mocks.search }),
  useNavigate: () => mocks.navigate,
  Link: ({ to, search, children, ...props }: { to: string; search?: Record<string, string>; children?: ReactNode }) => {
    const query = new URLSearchParams(search).toString();
    return <a href={`${to}${query ? `?${query}` : ""}`} {...props}>{children}</a>;
  },
}));

import { Route as AuthRoute } from "@/routes/auth";
import { Route as ResetRoute } from "@/routes/reset-password";
import { Route as IndexRoute } from "@/routes/index";
const AuthPage = AuthRoute.options.component as ComponentType;
const ResetPage = ResetRoute.options.component as ComponentType;
const IndexPage = IndexRoute.options.component as ComponentType;
let refreshAuth: (() => void) | undefined;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.search = {};
  refreshAuth = undefined;
  mocks.navigate.mockImplementation(async (options: { to: string; search?: { mode?: "forgot" } }) => {
    if (options.to === "/auth") { mocks.search = options.search ?? {}; refreshAuth?.(); }
  });
  mocks.readUser.mockResolvedValue({ id: "client-a", email: "client@example.test" });
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mocks.signIn.mockResolvedValue({ error: null });
  mocks.requestReset.mockResolvedValue({ error: null });
  mocks.updateUser.mockResolvedValue({ error: null });
});
afterEach(cleanup);

function renderAuth() {
  const view = render(<AuthPage />);
  refreshAuth = () => view.rerender(<AuthPage />);
  return view;
}
function fillSignIn() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "  client@example.test  " } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "  Keep my password spaces  " } });
  return screen.getByRole("button", { name: "Sign in" }).closest("form")!;
}
async function fillNewPassword(value = "  New password spaces  ") {
  await screen.findByLabelText("New password");
  fireEvent.change(screen.getByLabelText("New password"), { target: { value } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value } });
  return screen.getByRole("button", { name: "Save password" }).closest("form")!;
}

const savedSessionHint = { data: { session: { user: { id: "client-a" } } }, error: null };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}

describe("Returning visitor sessions", () => {
  it.each(["home", "auth"])("keeps a fresh %s immediately usable without a user verification request", async (page) => {
    if (page === "home") {
      render(<IndexPage />);
      expect(screen.getByRole("link", { name: "Open my projects" })).toHaveAttribute("href", "/auth");
    } else {
      renderAuth();
      expect(screen.getByLabelText("Email")).toBeEnabled();
      expect(screen.getByLabelText("Password")).toBeEnabled();
    }
    await waitFor(() => expect(screen.queryByText("Checking your saved sign-in…")).not.toBeInTheDocument());
    expect(mocks.getSession).toHaveBeenCalledOnce();
    expect(mocks.readUser).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it.each(["home", "auth"])("opens projects from %s only after verifying a saved session", async (page) => {
    const verification = deferred<{ id: string }>();
    mocks.getSession.mockResolvedValue(savedSessionHint);
    mocks.readUser.mockReturnValue(verification.promise);
    if (page === "home") {
      render(<IndexPage />);
      expect(screen.getByRole("link", { name: "Open my projects" })).toHaveAttribute("href", "/auth");
    } else {
      renderAuth();
      expect(screen.getByLabelText("Email")).toBeEnabled();
    }
    await waitFor(() => expect(mocks.readUser).toHaveBeenCalledOnce());
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => { verification.resolve({ id: "client-a" }); });
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/dashboard", replace: true });
  });

  it("leaves an invalid cached session on the usable form without redirecting or looping", async () => {
    mocks.getSession.mockResolvedValue(savedSessionHint);
    mocks.readUser.mockResolvedValue(null);
    renderAuth();
    await waitFor(() => expect(screen.queryByText("Checking your saved sign-in…")).not.toBeInTheDocument());
    expect(mocks.readUser).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Email")).toBeEnabled();
  });

  it("offers saved-session retry after a network error without signing out or blocking the form", async () => {
    mocks.getSession.mockResolvedValue(savedSessionHint);
    mocks.readUser.mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValueOnce({ id: "client-a" });
    renderAuth();
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn’t check your saved sign-in");
    expect(screen.getByLabelText("Email")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry saved sign-in" }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/dashboard", replace: true }));
  });

  it("does not check or redirect a saved session on the requested forgot-password form", async () => {
    mocks.search = { mode: "forgot" };
    mocks.getSession.mockResolvedValue(savedSessionHint);
    renderAuth();
    await act(async () => {});
    expect(screen.getByRole("heading", { name: "Reset password" })).toBeInTheDocument();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.readUser).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it.each(["hint", "verification"])("does not replace a user’s draft after a late %s result", async (phase) => {
    const hint = deferred<typeof savedSessionHint>();
    const verification = deferred<{ id: string }>();
    mocks.getSession.mockReturnValue(phase === "hint" ? hint.promise : Promise.resolve(savedSessionHint));
    mocks.readUser.mockReturnValue(verification.promise);
    renderAuth();
    if (phase === "verification") await waitFor(() => expect(mocks.readUser).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "draft@example.test" } });
    await act(async () => { hint.resolve(savedSessionHint); verification.resolve({ id: "client-a" }); });
    expect(screen.getByLabelText("Email")).toHaveValue("draft@example.test");
    expect(mocks.navigate).not.toHaveBeenCalled();
    if (phase === "hint") expect(mocks.readUser).not.toHaveBeenCalled();
  });

  it("ignores a late verification after switching to password recovery", async () => {
    const verification = deferred<{ id: string }>();
    mocks.getSession.mockResolvedValue(savedSessionHint);
    mocks.readUser.mockReturnValue(verification.promise);
    renderAuth();
    await waitFor(() => expect(mocks.readUser).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    await act(async () => { verification.resolve({ id: "client-a" }); });
    expect(screen.getByRole("heading", { name: "Reset password" })).toBeInTheDocument();
    expect(mocks.navigate.mock.calls.some(([options]) => options.to === "/dashboard")).toBe(false);
  });

  it("ignores a saved-session check that finishes after the page unmounts", async () => {
    const verification = deferred<{ id: string }>();
    mocks.getSession.mockResolvedValue(savedSessionHint);
    mocks.readUser.mockReturnValue(verification.promise);
    const view = renderAuth();
    await waitFor(() => expect(mocks.readUser).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => { verification.resolve({ id: "client-a" }); });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});

describe("Sign-in and reset-link forms", () => {
  it("shows pending feedback, blocks repeated submits and preserves an actionable sign-in error", async () => {
    let finish!: (value: { error: { message: string } }) => void;
    mocks.signIn.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderAuth();
    const form = fillSignIn();
    fireEvent.submit(form); fireEvent.submit(form);
    expect(mocks.signIn).toHaveBeenCalledOnce();
    expect(mocks.signIn).toHaveBeenCalledWith({ email: "client@example.test", password: "  Keep my password spaces  " });
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Forgot password?" })).toBeDisabled();
    await act(async () => { finish({ error: { message: "Email or password is incorrect." } }); });
    expect(screen.getByRole("alert")).toHaveTextContent("Email or password is incorrect.");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.getByLabelText("Password")).toHaveValue("  Keep my password spaces  ");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("unlocks sign-in after a thrown storage/network failure and permits retry", async () => {
    mocks.signIn.mockRejectedValueOnce(new Error("Connection unavailable")).mockResolvedValueOnce({ error: null });
    renderAuth();
    const form = fillSignIn();
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection unavailable");
    fireEvent.submit(form);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/dashboard" }));
    expect(mocks.signIn).toHaveBeenCalledTimes(2);
  });

  it("opens the requested reset form and confirms requests without disclosing account existence", async () => {
    mocks.search = { mode: "forgot" };
    let finish!: (value: { error: null }) => void;
    mocks.requestReset.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderAuth();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "client@example.test" } });
    const form = screen.getByRole("button", { name: "Send reset link" }).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(mocks.requestReset).toHaveBeenCalledOnce();
    expect(mocks.requestReset).toHaveBeenCalledWith("client@example.test", { redirectTo: `${window.location.origin}/reset-password` });
    expect(screen.getByRole("button", { name: "Sending reset link…" })).toBeDisabled();
    await act(async () => { finish({ error: null }); });
    expect(screen.getByRole("status")).toHaveTextContent("If an account matches this email");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("keeps reset request failures visible and allows another attempt", async () => {
    mocks.search = { mode: "forgot" };
    mocks.requestReset.mockRejectedValueOnce(new Error("Email service unavailable"));
    renderAuth();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "client@example.test" } });
    fireEvent.submit(screen.getByRole("button", { name: "Send reset link" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Email service unavailable");
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeEnabled();
  });
});

describe("New password form", () => {
  it("checks access before exposing the form and directs missing sessions to a new reset link", async () => {
    let finish!: (value: null) => void;
    mocks.readUser.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<ResetPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking your account");
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    await act(async () => { finish(null); });
    expect(screen.getByRole("alert")).toHaveTextContent("no active sign-in or valid reset link");
    expect(screen.getByRole("link", { name: "Request a new reset link" })).toHaveAttribute("href", "/auth?mode=forgot");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("offers retry for transient verification errors without claiming the link expired", async () => {
    mocks.readUser.mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValueOnce({ id: "client-a", email: "client@example.test" });
    render(<ResetPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not verify your account. Network unavailable");
    expect(screen.queryByRole("link", { name: "Request a new reset link" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("New password")).toBeEnabled();
    expect(mocks.readUser).toHaveBeenCalledTimes(2);
  });

  it("accepts an existing sign-in, requires confirmation and prevents duplicate password updates", async () => {
    let finish!: (value: { error: null }) => void;
    mocks.updateUser.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<ResetPage />);
    const form = await fillNewPassword();
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "Different password" } });
    fireEvent.submit(form);
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match");
    expect(mocks.updateUser).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "  New password spaces  " } });
    fireEvent.submit(form); fireEvent.submit(form);
    expect(mocks.updateUser).toHaveBeenCalledOnce();
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "  New password spaces  " });
    expect(screen.getByRole("button", { name: "Saving password…" })).toBeDisabled();
    await act(async () => { finish({ error: null }); });
    expect(screen.getByRole("status")).toHaveTextContent("Your password has been updated");
    expect(screen.getByRole("link", { name: "Continue to projects" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it.each(["returned", "thrown"])("recovers from a %s password-save error without losing the draft", async (kind) => {
    if (kind === "returned") mocks.updateUser.mockResolvedValueOnce({ error: { message: "Password was not saved" } });
    else mocks.updateUser.mockRejectedValueOnce(new Error("Password was not saved"));
    render(<ResetPage />);
    const form = await fillNewPassword();
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveTextContent("Password was not saved");
    expect(screen.getByRole("button", { name: "Save password" })).toBeEnabled();
    expect(screen.getByLabelText("New password")).toHaveValue("  New password spaces  ");
    fireEvent.submit(form);
    expect(await screen.findByRole("status")).toHaveTextContent("Your password has been updated");
  });

  it("explains an expired session during saving instead of leaving a broken form", async () => {
    mocks.updateUser.mockResolvedValueOnce({ error: { code: "session_not_found" } });
    render(<ResetPage />);
    fireEvent.submit(await fillNewPassword());
    expect(await screen.findByRole("link", { name: "Request a new reset link" })).toHaveAttribute("href", "/auth?mode=forgot");
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });
});
