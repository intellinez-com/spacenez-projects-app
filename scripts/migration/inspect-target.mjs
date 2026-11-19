import { openTarget } from "./connection.mjs";
const { sql, config } = openTarget();
try {
  const server = await sql`select current_database() as database, current_user as role, current_setting('server_version') as version`;
  const tables = await sql`select schemaname,tablename from pg_tables where schemaname='public' order by tablename`;
  const counts = await sql`select (select count(*)::int from auth.users) as users, (select count(*)::int from auth.identities) as identities, (select count(*)::int from storage.objects) as files`;
  const columns = await sql`select table_schema,table_name,column_name,data_type,udt_name,is_nullable,column_default,is_generated,generation_expression,is_identity from information_schema.columns where table_schema='auth' and table_name in ('users','identities') order by table_name,ordinal_position`;
  console.log(JSON.stringify({ projectRef: config.projectRef, server, tables, counts, authColumns: columns }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error.code ?? error.name, message: "Destination inspection failed; credentials were not logged." }));
  process.exitCode = 1;
} finally { await sql.end({ timeout: 3 }); }
