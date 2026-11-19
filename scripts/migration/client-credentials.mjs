// Run locally to view the initial client login. Never run in CI or paste its output in chat.
import { readPrivate } from "./connection.mjs";
if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.CI) throw new Error("Run this command in your own interactive terminal; credentials are never printed to CI or piped output.");
const credentials = readPrivate("client-onboarding.json");
console.log(`Client email: ${credentials.email}\nInitial password: ${credentials.password}\nLocal app: http://127.0.0.1:4174/auth\nShare through your approved private channel. The client should change the initial password after handoff.`);
