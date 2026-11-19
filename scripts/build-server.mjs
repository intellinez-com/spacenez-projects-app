import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const viteCli = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const result = spawnSync(process.execPath, [viteCli, "build"], {
  stdio: "inherit",
  env: { ...process.env, NITRO_PRESET: "node-server" },
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
