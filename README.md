# Spacenez project portal

Client project activity, progress, work dates, discussion, private project files and revision-specific approvals. Clients see the latest actual project change on their project list and land on Daily status, with Today, This week and So far views. Task/project edits, shared files, comments and approval actions appear automatically; clients can view, comment and respond to approval requests.

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

For admin review, open http://127.0.0.1:4173/dashboard?previewRole=admin. Projects open on a spreadsheet task sheet with inline status, owner, dates and priority, plus row comments/files. Adding and editing sample tasks stays in memory; Progress shows the sample activity automatically. Clients open on Progress with read-only tasks. The four main sections are Tasks, Progress, Photos & files, and Approvals; More contains secondary project options.

Admin payment setup is under More > Payments. The isolated demo has a blank payment plan and in-memory quote/milestone/advance entry. Payment demo in the preview banner can show a proposed client payment screen and demo checkout; no bank or live database is contacted. Production client Payments stays hidden pending explicit launch approval.

The project importer accepts `.xlsx` and UTF-8 `.csv` and offers an Excel-readable template. Admins review task dates, source owners and stage mappings before creation; prepared JSON is an advanced support option. In the local preview, file review works and final project creation is disabled. See `deploy/ADMIN-REVIEW.txt`.

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

`deploy/DAILY-STATUS.txt` describes automatic project activity and its applied migrations. The database records actors, times and actual changes; current overall task totals remain separate from the dated change history. Posting a daily report is not required.

`deploy/PAYMENTS.txt` describes configurable project payment tracking: agreed totals, milestones, advances, partial receipts, client reports and admin verification. Financial details start unset; admins enter the actual agreement. Online collection and recurring subscriptions require a separate gateway integration.

Never commit filled environment files, client import files, data exports, credentials or `.migration-private`. Git and Docker exclusions cover these paths.

Built with TanStack Start, React, TypeScript, Tailwind CSS and Supabase. Originally created in Lovable; this checkout is prepared for company infrastructure deployment.
