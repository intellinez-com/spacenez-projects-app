import { targetApi } from "./api.mjs";
for (const [path, privileged] of [["/auth/v1/settings", false], ["/auth/v1/admin/users?per_page=1", true], ["/storage/v1/bucket", true]]) {
  const result = await targetApi(path, { privileged });
  console.log(JSON.stringify({ path, status: result.status, ...(path.endsWith("settings") ? { disableSignup: result.data?.disable_signup } : path.includes("users") ? { usersReturned: result.data?.users?.length } : { bucketsReturned: Array.isArray(result.data) ? result.data.length : undefined }) }));
  if (!result.ok) process.exitCode = 1;
}
