import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { openTarget, readPrivate } from "./connection.mjs";

const sourceRef = "cxcwnslhgcklrtwkwjje";
const expected = { profiles: 1, user_roles: 1, projects: 1, tasks: 20, project_members: 0, comments: 0, documents: 0 };
const files = ["drizzle/migrations/0000_migration.sql", "drizzle/migrations/0001_migration.sql", "supabase/migrations/20261119091954_portal_workflows.sql"];
const additions = { projects: ["client_brand", "client_email", "meeting_url"], tasks: ["content_revision", "source_id", "source_metadata"] };
const archivedAuth = new Set(["schema_migrations", "sessions", "refresh_tokens", "mfa_amr_claims"]);
const quote = (name) => { if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error("Invalid identifier"); return `"${name}"`; };
const sha = (value) => createHash("sha256").update(value).digest("hex");
const ensure = (condition) => { if (!condition) throw new Error("Migration precondition or reconciliation failed"); };
let operation = "read-snapshot";
let sql;

try {
  const name = process.argv[2] ?? "source-snapshot-2026-11-19.json";
  ensure(/^source-snapshot-[0-9-]+\.json$/.test(name));
  const snapshot = readPrivate(name);
  ensure(snapshot.format === "spacenez-source-snapshot-v1" && snapshot.source_ref === sourceRef);
  ensure(snapshot.public && snapshot.auth && snapshot.storage && Array.isArray(snapshot.columns));
  ensure(Object.keys(snapshot.public).sort().join() === Object.keys(expected).sort().join());
  for (const [table, count] of Object.entries(expected)) ensure(Array.isArray(snapshot.public[table]) && snapshot.public[table].length === count);
  ensure(snapshot.auth.users?.length === 1 && snapshot.auth.identities?.length === 1);
  for (const [table, rows] of Object.entries(snapshot.auth)) {
    ensure(Array.isArray(rows));
    if (!["users", "identities"].includes(table) && !archivedAuth.has(table)) ensure(rows.length === 0);
  }
  ensure(Array.isArray(snapshot.storage.objects) && snapshot.storage.objects.length === 0);
  ensure(Array.isArray(snapshot.storage.buckets) && snapshot.storage.buckets.length === 1);
  const bucket = snapshot.storage.buckets[0];
  ensure(bucket.id === "project-files" && bucket.public === false && Number(bucket.file_size_limit) === 52428800);
  operation = "read-migrations";
  const migrations = await Promise.all(files.map(async (path) => {
    const text = await readFile(new URL(`../../${path}`, import.meta.url), "utf8");
    return { path, sha256: sha(text), text };
  }));
  const manifest = migrations.map(({ path, sha256 }) => ({ path, sha256 }));
  const snapshotHash = sha(JSON.stringify(snapshot));
  operation = "connect-target";
  ({ sql } = openTarget());
  const result = await sql.begin(async (tx) => {
    await tx`set local timezone = 'UTC'`;
    await tx`select pg_advisory_xact_lock(hashtextextended('spacenez-source-restore-v1', 0))`;
    const targetColumns = async (schema, table) => tx`
      select column_name,is_nullable,column_default,is_generated,is_identity,udt_name
      from information_schema.columns where table_schema=${schema} and table_name=${table} order by ordinal_position`;
    const insertRows = async (schema, table, rows) => {
      if (!rows.length) return;
      operation = `map-${schema}-${table}`;
      const columns = await targetColumns(schema, table);
      ensure(columns.length > 0);
      const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      const existing = new Map(columns.map((column) => [column.column_name, column]));
      for (const key of keys) if (!existing.has(key)) ensure(rows.every((row) => row[key] == null));
      const selected = columns.filter((column) => keys.includes(column.column_name) && column.is_generated === "NEVER" && column.is_identity !== "YES");
      for (const column of columns) {
        if (column.is_generated !== "NEVER" || column.is_identity === "YES") continue;
        if (column.is_nullable === "NO" && column.column_default == null) ensure(selected.includes(column) && rows.every((row) => row[column.column_name] != null));
        const original = snapshot.columns.find((entry) => entry.table_schema === schema && entry.table_name === table && entry.column_name === column.column_name);
        if (original && keys.includes(column.column_name)) ensure(original.udt_name === column.udt_name);
      }
      ensure(selected.length > 0);
      const relation = `${quote(schema)}.${quote(table)}`;
      const names = selected.map((column) => quote(column.column_name)).join(",");
      operation = `insert-${schema}-${table}`;
      await tx.unsafe(`insert into ${relation} (${names}) select ${names} from jsonb_populate_recordset(null::${relation}, $1::jsonb)`, [tx.json(rows)]);
    };
    const reconcile = async (schema, table, rows) => {
      operation = `verify-${schema}-${table}`;
      const relation = `${quote(schema)}.${quote(table)}`;
      const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      const projection = schema === "public" ? "to_jsonb(t) - $2::text[]" : "(select jsonb_object_agg(k, to_jsonb(t)->k) from unnest($2::text[]) k)";
      const compared = await tx.unsafe(`with wanted as (select value as row from jsonb_array_elements($1::jsonb)), actual as (select ${projection} as row from ${relation} t)
        select (select count(*)::int from actual) as count, not exists ((select row from wanted except select row from actual) union all (select row from actual except select row from wanted)) as matches`,
      [tx.json(rows), schema === "public" ? (additions[table] ?? []) : keys]);
      ensure(compared[0]?.matches && compared[0].count === rows.length);
      return compared[0].count;
    };
    const verifyAll = async () => {
      const counts = {};
      for (const table of ["users", "identities"]) counts[`auth.${table}`] = await reconcile("auth", table, snapshot.auth[table]);
      for (const table of Object.keys(expected)) counts[`public.${table}`] = await reconcile("public", table, snapshot.public[table]);
      operation = "verify-bucket";
      const buckets = await tx`select to_jsonb(b) as row from storage.buckets b`;
      ensure(buckets.length === 1);
      for (const [key, value] of Object.entries(bucket)) ensure(JSON.stringify(buckets[0].row[key]) === JSON.stringify(value));
      ensure((await tx`select count(*)::int as count from storage.objects`)[0].count === 0);
      return counts;
    };
    operation = "inspect-ledger";
    const hasLedger = (await tx`select to_regclass('portal_migration_private.source_restores') is not null as present`)[0].present;
    if (hasLedger) {
      const ledger = await tx`select source_ref,snapshot_sha256,migrations=${tx.json(manifest)}::jsonb as manifest_matches from portal_migration_private.source_restores`;
      ensure(ledger.length === 1 && ledger[0].source_ref === sourceRef && ledger[0].snapshot_sha256 === snapshotHash && ledger[0].manifest_matches);
      return { noop: true, counts: await verifyAll() };
    }
    operation = "require-empty-destination";
    ensure((await tx`select count(*)::int as count from pg_tables where schemaname='public'`)[0].count === 0);
    const empty = (await tx`select (select count(*)::int from auth.users) as users, (select count(*)::int from auth.identities) as identities, (select count(*)::int from storage.objects) as objects, (select count(*)::int from storage.buckets) as buckets`)[0];
    ensure(Object.values(empty).every((count) => count === 0));
    for (const { tablename } of await tx`select tablename from pg_tables where schemaname='auth' and tablename<>'schema_migrations'`) {
      operation = `require-empty-auth-${tablename}`;
      ensure((await tx.unsafe(`select count(*)::int as count from auth.${quote(tablename)}`))[0].count === 0);
    }
    // Auth first: the application bootstrap trigger does not exist yet.
    await insertRows("auth", "users", snapshot.auth.users);
    await insertRows("auth", "identities", snapshot.auth.identities);
    for (const migration of migrations) { operation = `apply-${migration.path}`; await tx.unsafe(migration.text).simple(); }
    for (const table of Object.keys(expected)) await insertRows("public", table, snapshot.public[table]);
    // The feature migration creates the bucket. Restore every writable source setting.
    operation = "restore-bucket-settings";
    const bucketColumns = await targetColumns("storage", "buckets");
    const bucketKeys = Object.keys(bucket);
    for (const key of bucketKeys) if (!bucketColumns.some((column) => column.column_name === key)) ensure(bucket[key] == null);
    const currentBucket = (await tx`select to_jsonb(b) as row from storage.buckets b where id=${bucket.id}`)[0]?.row;
    ensure(currentBucket);
    // Do not name unchanged platform control columns in UPDATE: their managed guards
    // intentionally require the Storage service role even for a no-op assignment.
    const writable = bucketColumns.filter((column) => bucketKeys.includes(column.column_name) && column.column_name !== "id" && column.is_generated === "NEVER" && column.is_identity !== "YES" && JSON.stringify(bucket[column.column_name]) !== JSON.stringify(currentBucket[column.column_name]));
    const assignments = writable.map((column) => `${quote(column.column_name)}=source.${quote(column.column_name)}`).join(",");
    if (assignments) await tx.unsafe(`update storage.buckets as target set ${assignments} from jsonb_populate_record(null::storage.buckets,$1::jsonb) as source where target.id=source.id`, [tx.json(bucket)]);
    const counts = await verifyAll();
    operation = "record-ledger";
    await tx.unsafe(`create schema portal_migration_private; revoke all on schema portal_migration_private from public,anon,authenticated;
      create table portal_migration_private.source_restores(run_ref uuid primary key,source_ref text not null,snapshot_sha256 text not null,migrations jsonb not null,counts jsonb not null,completed_at timestamptz not null default now());
      revoke all on portal_migration_private.source_restores from public,anon,authenticated`).simple();
    await tx`insert into portal_migration_private.source_restores(run_ref,source_ref,snapshot_sha256,migrations,counts) values (${randomUUID()},${sourceRef},${snapshotHash},${tx.json(manifest)},${tx.json(counts)})`;
    return { noop: false, counts };
  });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ operation, code: String(error?.code ?? error?.name ?? "UNKNOWN").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40), failed: true }));
  process.exitCode = 1;
} finally {
  if (sql) { try { await sql.end({ timeout: 3 }); } catch { process.exitCode = 1; } }
}
