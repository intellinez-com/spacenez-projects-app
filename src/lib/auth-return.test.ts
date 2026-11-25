import { describe, expect, it } from "vitest";
import { authReturnDestination, safeAuthReturnTo } from "./auth-return";

const projectId = "11111111-1111-4111-8111-111111111111";

describe("portal destinations after sign-in", () => {
  it.each(["/dashboard", "/people", `/projects/${projectId}`])("accepts the canonical portal path %s", (path) => {
    expect(safeAuthReturnTo(path)).toBe(path);
  });

  it.each([
    undefined, null, 123, {}, ["/dashboard"], "", "/", "/auth", "/reset-password",
    "https://app.spacenez.com/dashboard", "https://example.test", "//example.test/dashboard",
    "\\\\example.test\\dashboard", "/\\example.test", "/dashboard\\evil", "/dashboard/",
    "/dashboard?next=https://example.test", "/dashboard#anything", " /dashboard", "/dashboard ",
    "/dashboard\n", "/people/../dashboard", "/projects/not-a-uuid", `/projects/${projectId}/files`,
    `/projects/${projectId}?previewRole=admin`, `/projects/${projectId}#files`,
    `/projects/${projectId}\n`,
    "/%64ashboard", "/projects/%2f%2fexample.test", "/projects/11111111111141118111111111111111",
  ])("rejects noncanonical or external return targets: %s", (value) => {
    expect(safeAuthReturnTo(value)).toBeUndefined();
    expect(authReturnDestination(value)).toEqual({ to: "/dashboard" });
  });

  it("builds a parameterized project destination without passing a URL through navigation", () => {
    expect(authReturnDestination(`/projects/${projectId}`)).toEqual({ to: "/projects/$id", params: { id: projectId } });
    expect(authReturnDestination("/people")).toEqual({ to: "/people" });
    expect(authReturnDestination("/dashboard")).toEqual({ to: "/dashboard" });
  });
});
