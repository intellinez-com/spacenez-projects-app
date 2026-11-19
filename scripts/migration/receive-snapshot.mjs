import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const [name] = process.argv.slice(2);
if (!/^source-snapshot-[0-9-]+\.json$/.test(name ?? "")) throw new Error("Expected a private snapshot name");
if (!process.stdin.isTTY) throw new Error("A private input terminal is required");
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
let encoded = "";
console.log("Ready for private snapshot input (terminal echo disabled).");
process.stdin.on("data", (chunk) => {
  if (chunk.includes("\u0003")) process.exit(1);
  encoded += chunk;
  if (encoded.length > 3_000_000) process.exit(1);
  if (!/[\r\n]/.test(encoded)) return;
  process.stdin.pause();
  const payload = Buffer.from(encoded.trim(), "base64");
  const checksum = createHash("sha256").update(payload).digest("hex");
  const snapshot = JSON.parse(payload.toString("utf8"));
  if (snapshot.source_ref !== "cxcwnslhgcklrtwkwjje") throw new Error("Unexpected snapshot source");
  execFileSync("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ["-NoProfile", "-File", fileURLToPath(new URL("./private-file.ps1", import.meta.url)), "-Mode", "save", "-Path", fileURLToPath(new URL(`../../.migration-private/${name}`, import.meta.url))], { input: payload, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  console.log(`Encrypted snapshot saved and DPAPI round-trip verified: ${name}.dpapi; SHA-256 ${checksum}`);
  process.stdin.setRawMode(false);
  process.exit(0);
});
