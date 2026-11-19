import { readPrivate } from "./connection.mjs";
const config = readPrivate("target-connection.json");
for (const path of ["/auth", "/src/integrations/supabase/client.ts", "/.migration-private/target-connection.json.dpapi", "/outputs/launch-preparation-2026-11-19/project-import-staging.json"]) {
  const response = await fetch(`http://127.0.0.1:4174${path}`, { signal: AbortSignal.timeout(30_000) });
  const body = await response.text();
  const result = { path, status: response.status };
  if (path.endsWith("client.ts")) {
    result.destinationConfigured = body.includes(config.apiUrl);
    result.secretExposed = body.includes(config.apiSecret) || body.includes(config.password);
    if (!result.destinationConfigured || result.secretExposed) process.exitCode = 1;
  } else if (path.startsWith("/.migration-private") || path.startsWith("/outputs")) {
    if (![403, 404].includes(response.status)) process.exitCode = 1;
  } else if (!response.ok) process.exitCode = 1;
  console.log(JSON.stringify(result));
}
