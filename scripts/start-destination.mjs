import { spawn } from "node:child_process";
import { readPrivate } from "./migration/connection.mjs";
const config = readPrivate("target-connection.json");
if (config.projectRef !== "cwhofudilhawuvmhzgdx") throw new Error("Unexpected destination");
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4174", "--strictPort"], {
  windowsHide: true, stdio: "inherit",
  env: { ...process.env, VITE_SUPABASE_PROJECT_ID: config.projectRef, VITE_SUPABASE_URL: config.apiUrl, VITE_SUPABASE_PUBLISHABLE_KEY: config.publishableKey, SUPABASE_PROJECT_ID: config.projectRef, SUPABASE_URL: config.apiUrl, SUPABASE_PUBLISHABLE_KEY: config.publishableKey, SUPABASE_SERVICE_ROLE_KEY: config.apiSecret },
});
server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
server.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill());
