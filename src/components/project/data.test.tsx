import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fmtSize, loadProject, openDoc, uploadDoc, useTaskMutations } from "./data";

const mocks = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), getUser: vi.fn(), storageFrom: vi.fn(),
  upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn(), toastError: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: mocks.from, rpc: mocks.rpc, auth: { getUser: mocks.getUser }, storage: { from: mocks.storageFrom },
} }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

function query(result: { data: unknown; error: unknown }) {
  const value: any = {};
  for (const method of ["select", "eq", "order", "update", "insert", "delete"]) value[method] = vi.fn(() => value);
  value.single = vi.fn(async () => result);
  value.maybeSingle = vi.fn(async () => result);
  value.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return value;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user" } }, error: null });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.storageFrom.mockReturnValue({ upload: mocks.upload, remove: mocks.remove, createSignedUrl: mocks.createSignedUrl });
});

describe("project request reliability", () => {
  it("loads checked owner options including an admin who is not a project member", async () => {
    const member = { user_id: "client", access: "client", profile: { id: "client", full_name: "Sample client" } };
    const owners = [
      { id: "admin", full_name: "Sample admin", email: "admin@example.test" },
      { id: "client", full_name: "Sample client", email: "client@example.test" },
    ];
    mocks.from.mockImplementation((table: string) => query({ data: table === "projects" ? { id: "project" } : table === "project_members" ? [member] : [], error: null }));
    mocks.rpc.mockResolvedValue({ data: owners, error: null });
    const result = await loadProject("project");
    expect(mocks.rpc).toHaveBeenCalledWith("get_project_task_people", { p_project_id: "project" });
    expect(result.members).toEqual([member]);
    expect(result.people).toEqual(owners);
    expect(mocks.from).not.toHaveBeenCalledWith("profiles");
    expect(mocks.from).not.toHaveBeenCalledWith("user_roles");
  });

  it("reports owner lookup errors instead of silently showing an incomplete list", async () => {
    mocks.from.mockImplementation((table: string) => query({ data: table === "projects" ? { id: "project" } : [], error: null }));
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Owner lookup unavailable" } });
    await expect(loadProject("project")).rejects.toThrow("Task owners could not be loaded. Owner lookup unavailable");
  });

  it("rejects a missing owner response rather than treating it as an empty list", async () => {
    mocks.from.mockImplementation((table: string) => query({ data: table === "projects" ? { id: "project" } : [], error: null }));
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(loadProject("project")).rejects.toThrow("Task owners could not be loaded.");
  });

  it("does not request people for a project the viewer cannot see", async () => {
    mocks.from.mockImplementation((table: string) => query({ data: table === "projects" ? null : [], error: null }));
    const result = await loadProject("missing-project");
    expect(result.project).toBeNull();
    expect(result.people).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["tasks", "project_members", "documents"])("fails the page when %s cannot be loaded", async (failedTable) => {
    const error = { message: `${failedTable} unavailable` };
    mocks.from.mockImplementation((table: string) => query({ data: table === "projects" ? { id: "project" } : [], error: table === failedTable ? error : null }));
    await expect(loadProject("project")).rejects.toEqual(error);
  });

  it("keeps cached content on denied updates and scopes the mutation to its project", async () => {
    const denied = query({ data: null, error: { message: "Permission denied" } });
    mocks.from.mockReturnValue(denied);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const original = { tasks: [{ id: "task", title: "Original" }], project: { id: "project" }, members: [], documents: [] };
    client.setQueryData(["project", "project"], original);
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useTaskMutations("project"), { wrapper });
    await act(async () => {
      await expect(result.current.update("task", { title: "Changed", project_id: "other", content_revision: 99 })).rejects.toEqual({ message: "Permission denied" });
    });
    expect(client.getQueryData(["project", "project"])).toEqual(original);
    expect(denied.eq).toHaveBeenCalledWith("project_id", "project");
    expect(denied.update).toHaveBeenCalledWith({ title: "Changed" });
  });

  it("rejects deletion when no row was returned", async () => {
    mocks.from.mockReturnValue(query({ data: null, error: null }));
    const client = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useTaskMutations("project"), { wrapper });
    await expect(result.current.remove("task")).rejects.toThrow("could not be deleted");
  });
});

describe("project files", () => {
  it("removes the uploaded object if saving its document record fails", async () => {
    mocks.from.mockReturnValue(query({ data: null, error: { message: "Document insert failed" } }));
    await expect(uploadDoc("project", new File(["test"], "plan.pdf"), "task")).rejects.toEqual({ message: "Document insert failed" });
    const path = mocks.upload.mock.calls[0]?.[0];
    expect(path).toMatch(/^project\//);
    expect(mocks.remove).toHaveBeenCalledWith([path]);
  });

  it("does not upload after the session has expired", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(uploadDoc("project", new File(["test"], "plan.pdf"))).rejects.toThrow("session has expired");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("opens the window before awaiting a signed URL", async () => {
    const preview = { opener: {}, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(preview as unknown as Window);
    mocks.createSignedUrl.mockImplementation(async () => {
      expect(open).toHaveBeenCalledWith("about:blank", "_blank");
      return { data: { signedUrl: "https://storage.example/signed" }, error: null };
    });
    await openDoc("project/file");
    expect(preview.location.href).toBe("https://storage.example/signed");
    expect(preview.opener).toBeNull();
    open.mockRestore();
  });

  it("reports a blocked window without requesting a signed URL", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await openDoc("project/file");
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining("blocked"));
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("shows an explicit size for empty files", () => expect(fmtSize(0)).toBe("0 B"));
});
