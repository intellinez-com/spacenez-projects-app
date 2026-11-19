import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readPrivate } from "./connection.mjs";
const target = readPrivate("target-connection.json");
const source = readPrivate("source-snapshot-2026-11-19.json");
const plan = JSON.parse(readFileSync("outputs/launch-preparation-2026-11-19/project-import-staging.json", "utf8"));
const client = readPrivate("client-onboarding.json");
const restricted = [target.apiSecret, target.password, client.password, client.email, client.fullName, ...source.auth.users.map((u) => u.encrypted_password), ...source.public.profiles.map((p) => p.email), plan.project_metadata.client_email, plan.project_metadata.client_name].filter((value) => typeof value === "string" && value.length > 5);
const files = execFileSync("git", ["diff", "--cached", "--name-only", "-z"], { encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
const hits = [];
for (const path of files) {
  if (/^(?:\.migration-private|outputs|node_modules|\.output)\//.test(path) || /^\.env(?:\.|$)/.test(path) && path !== ".env.example" || /\.(?:dpapi|backup|dump)$/.test(path)) { hits.push(path); continue; }
  const bytes = readFileSync(path);
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  if (restricted.some((value) => text.includes(value)) || /sb_secret_[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) { hits.push(path); continue; }
  for (const token of text.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    try { if (JSON.parse(Buffer.from(token[0].split(".")[1], "base64url").toString()).role === "service_role") hits.push(path); } catch { /* not a JWT */ }
  }
}
console.log(JSON.stringify({ stagedFiles: files.length, restrictedDataFound: hits.length > 0, paths: [...new Set(hits)] }));
if (hits.length) process.exitCode = 1;
