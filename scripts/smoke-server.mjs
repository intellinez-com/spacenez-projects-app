import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

await access(new URL("../.output/server/index.mjs", import.meta.url));
const port = process.env["SMOKE_PORT"] || "4319";
const server = spawn(process.execPath, [".output/server/index.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, HOST: "127.0.0.1", PORT: port },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let startupError;
server.on("error", (error) => { startupError = error; });
// Keep runtime logs out of HTTP results; surface them if startup fails.
let logs = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", (data) => { logs = (logs + data.toString()).slice(-4000); });
}

try {
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (true) {
    if (startupError) throw startupError;
    if (server.exitCode !== null) throw new Error(`Server exited during startup. ${logs}`);
    try {
      await fetch(`${base}/auth`, { signal: AbortSignal.timeout(1000) });
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw new Error(`Server did not start. ${logs}`, { cause: error });
      await setTimeout(100);
    }
  }
  for (const [path, contentType] of [["/auth", "text/html"], ["/reset-password", "text/html"], ["/favicon.png", "image/png"]]) {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(5000) });
    if (response.status !== 200 || !response.headers.get("content-type")?.includes(contentType)) {
      throw new Error(`${path}: unexpected HTTP ${response.status} or content type`);
    }
    await response.arrayBuffer();
    console.log(`${path}: HTTP 200 (${contentType})`);
  }
  console.log("Node startup smoke passed. Authenticated workflows require staging checks.");
} finally {
  server.kill();
}
