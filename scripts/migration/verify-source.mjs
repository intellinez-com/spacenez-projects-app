import { openTarget, readPrivate } from "./connection.mjs";
const snapshot = readPrivate("source-snapshot-2026-11-19.json");
const { sql } = openTarget();
const added = { projects: ["client_brand", "client_email", "meeting_url"], tasks: ["content_revision", "source_id", "source_metadata"] };
try {
  const result = await sql.begin(async (tx) => {
    await tx`set local timezone = 'UTC'`;
    const matches = {};
    for (const [schema, tables] of [["public", snapshot.public], ["auth", { users: snapshot.auth.users, identities: snapshot.auth.identities }]]) {
      for (const [table, rows] of Object.entries(tables)) {
        if (!/^[a-z_]+$/.test(table)) throw new Error("Unexpected relation");
        const keys = [...new Set(rows.flatMap(Object.keys))];
        const projected = schema === "public" ? "to_jsonb(t)-$2::text[]" : "(select jsonb_object_agg(k,to_jsonb(t)->k) from unnest($2::text[]) k)";
        const compared = await tx.unsafe(`with wanted as (select value as row from jsonb_array_elements($1::jsonb)), actual as (select ${projected} as row from ${schema}.${table} t where id::text in (select row->>'id' from wanted)) select not exists((select row from wanted except select row from actual) union all (select row from actual except select row from wanted)) as matches`, [tx.json(rows), schema === "public" ? added[table] ?? [] : keys]);
        if (!compared[0].matches) throw new Error("Source reconciliation failed");
        matches[`${schema}.${table}`] = rows.length;
      }
    }
    const totals = (await tx`select (select count(*)::int from auth.users) users,(select count(*)::int from public.projects) projects,(select count(*)::int from public.tasks) tasks,(select count(*)::int from public.task_approval_plan) planned_approvals,(select count(*)::int from public.task_approvals) actual_approvals,(select count(*)::int from storage.objects) files`)[0];
    return { originalRecordsMatch: true, sourceCounts: matches, totals };
  });
  console.log(JSON.stringify(result));
} catch (error) { console.error(JSON.stringify({ verificationFailed: true, code: error.code ?? error.name })); process.exitCode = 1; }
finally { await sql.end({ timeout: 3 }); }
