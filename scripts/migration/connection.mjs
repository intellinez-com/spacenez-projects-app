import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import postgres from "postgres";

export const workspace = fileURLToPath(new URL("../../", import.meta.url));
export function readPrivate(name) {
  if (!/^[a-z0-9.-]+$/i.test(name)) throw new Error("Invalid private file name");
  const value = execFileSync("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ["-NoProfile", "-File", fileURLToPath(new URL("./private-file.ps1", import.meta.url)), "-Mode", "read", "-Path", fileURLToPath(new URL(`../../.migration-private/${name}.dpapi`, import.meta.url))], { encoding: "utf8", windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(value.replace(/^\uFEFF/, ""));
}
export function openTarget() {
  const config = readPrivate("target-connection.json");
  if (config.projectRef !== "cwhofudilhawuvmhzgdx" || config.username !== `postgres.${config.projectRef}` || config.port !== 5432) throw new Error("Unexpected migration destination");
  const sql = postgres({ host: config.host, port: config.port, database: config.database, username: config.username, password: config.password, ssl: { rejectUnauthorized: true, ca: readFileSync(new URL("./supabase-ca.crt", import.meta.url), "utf8") }, max: 1, prepare: false, connect_timeout: 15, idle_timeout: 5, onnotice: () => {} });
  return { sql, config };
}
