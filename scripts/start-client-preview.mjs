import { spawn } from "node:child_process";

const preview = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--mode", "client-preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], {
  stdio: "inherit",
  windowsHide: true,
  env: process.env,
});
preview.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
preview.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => preview.kill());
