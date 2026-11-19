# Spacenez project portal

Client progress, work dates, updates/comments, private project files and revision-specific approvals. Admins manage accounts and project membership; clients can view, comment and respond to approval requests.

## Local development

Use Node.js 22 and Bun 1.4.5:

```sh
bun install --frozen-lockfile --ignore-scripts
```

Copy `.env.example` to an ignored local environment file and provide the server-only key through your local secret manager. `npm run dev` starts the normal app using that configuration.

For a fictional client usability preview without backend writes:

```sh
npm run dev:client
```

Open http://127.0.0.1:4173/dashboard. Sample sign-in is `client@example.test` / `preview-client`. Preview changes reset on refresh. This mode cannot be built for deployment.

On the migration operator's Windows machine only, `npm run dev:target` uses the encrypted local connection configuration and serves the real destination at http://127.0.0.1:4174. Other checkouts should use normal environment configuration.

The initial client login is stored only in the operator's encrypted local files. The operator can view it privately with `npm run client:credentials` and hand it over through the approved private channel. This command is not for CI; its output must not be committed or posted in chat.

## Validation and deployment

```sh
node node_modules/typescript/bin/tsc --noEmit --pretty false
npm test
npm run build:server
npm start
```

Build the complete `.output` directory on the deployment OS. Configure public build variables and server-only runtime credentials as described in `deploy/INFRA.txt`. Production target: `app.spacenez.com`.

`deploy/MIGRATION-STATUS.txt` records the completed backend copy and remaining launch checks. `deploy/FEATURE-CHECKS.txt` lists the authenticated acceptance flows. The database has already been migrated; read the migration-history note before running any schema deployment commands.

Never commit filled environment files, client import files, data exports, credentials or `.migration-private`. Git and Docker exclusions cover these paths.

Built with TanStack Start, React, TypeScript, Tailwind CSS and Supabase. Originally created in Lovable; this checkout is prepared for company infrastructure deployment.
