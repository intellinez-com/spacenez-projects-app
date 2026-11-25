const PROJECT_PATH = /^\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Only canonical portal pages may be restored after sign-in. */
export function safeAuthReturnTo(value: unknown): string | undefined {
  if (typeof value !== "string" || value !== value.trim()) return undefined;
  return value === "/dashboard" || value === "/people" || PROJECT_PATH.test(value) ? value : undefined;
}

type AuthReturnDestination =
  | { to: "/dashboard" }
  | { to: "/people" }
  | { to: "/projects/$id"; params: { id: string } };

/** Use a typed router destination instead of passing an untrusted URL to navigation. */
export function authReturnDestination(value: unknown): AuthReturnDestination {
  const path = safeAuthReturnTo(value);
  if (path === "/people") return { to: "/people" };
  const project = path?.match(PROJECT_PATH);
  if (project?.[1]) return { to: "/projects/$id", params: { id: project[1] } };
  return { to: "/dashboard" };
}
