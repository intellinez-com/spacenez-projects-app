import { readPrivate } from "./connection.mjs";

export const apiConfig = readPrivate("target-connection.json");
if (apiConfig.apiUrl !== "https://cwhofudilhawuvmhzgdx.supabase.co") throw new Error("Unexpected API destination");
export async function targetApi(path, { method = "GET", body, token, privileged = false, headers = {} } = {}) {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Expected a relative API path");
  const response = await fetch(apiConfig.apiUrl + path, {
    method, redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { apikey: privileged ? apiConfig.apiSecret : apiConfig.publishableKey, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: response.status, ok: response.ok, data };
}
