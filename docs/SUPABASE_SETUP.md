# Connect TraceRisk to Supabase

The code is ready, but your Supabase schema and Render environment must be configured before switching the live site. No dashboard changes are made by a GitHub push alone.

## 1. Create the database tables

In your Supabase project, open **SQL Editor → New query**. Paste the complete contents of [202610230001_tracerisk.sql](../supabase/migrations/202610230001_tracerisk.sql) and click **Run**. It creates three private tables and ownership-checked functions; it does not delete existing data. Do not disable row-level security or expose tables publicly.

## 2. Configure authentication URLs

Under **Authentication → URL Configuration**:

- Site URL: `https://tracerisk.onrender.com`
- Add Redirect URL: `https://tracerisk.onrender.com/auth/callback`
- Add Redirect URL: `https://tracerisk.onrender.com/auth/callback?recovery=*`

Keep Email enabled and Confirm email enabled under **Sign In / Providers → Email**. Use the normal Supabase confirmation/reset templates that include `{{ .ConfirmationURL }}`. Open confirmation/reset links in the browser that requested them, because the sign-in flow uses PKCE.

Supabase's built-in mail service is restricted and rate-limited, and may only send to project-team addresses. Test with your project email first. For public signups/password-reset delivery, configure your own SMTP provider under Authentication email settings. Check current provider free allowances; no SMTP credentials are required by TraceRisk itself, and no real test email is sent by automated tests.

## 3. Add Render environment variables together

Open **Render → TraceRisk → Environment**. Add these three public settings and the server secret described below, then save/redeploy together:

```text
SUPABASE_URL=https://bpvuolxugcmqqwdplpbo.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_wMteWx5CkBht8ZKSazowFQ_TEfd_ZnS
SITE_URL=https://tracerisk.onrender.com
```

The publishable key is public; it is not a database password. Also open **Supabase → Project Settings → API Keys**, copy the **secret key**, and paste it **directly into Render** as `SUPABASE_SECRET_KEY`. A legacy `service_role` JWT can also be used. **Never send this secret in chat, put it in GitHub, or use a `VITE_` variable.**

The app uses HttpOnly cookies and verifies Supabase users on the server. Reads are scoped to the verified user. Trip writes use the server secret through ownership-checked functions, so browser clients cannot forge server-generated reports or shared evidence. All four settings must be configured together; incomplete configuration fails startup rather than silently saving somewhere else. The SQLite database is no longer used for new accounts/trips in Supabase mode.

Without these settings, existing local SQLite authentication and storage still work. This keeps a GitHub deployment from switching before the database setup is ready. Supabase free-plan quotas and inactivity/pausing rules still apply.

## 4. Trip Watch hosting

The server secret also enables scheduled checks while users are offline. Render Free can sleep, so the selected watch frequency is still not an uptime guarantee. Supabase preserves data across app redeployments but does not keep Render awake. Set `TRIP_WATCH_ENABLED=false` if you want only manual checks.

## 5. Verify the deployed site

1. Register using your project email. Confirm the email and sign in.
2. Save a trip, reload the page, then sign out/sign in and check it remains.
3. Run a check, make a comparison and create/revoke a public briefing.
4. Use Forgot password and open the reset email in the same browser.
5. Check that users appear in Supabase Authentication and rows appear in the `tracerisk_*` tables.
6. Sign in with a second account and verify that the first account's trips are not visible.

Automated tests validate the migration in an embedded PostgreSQL engine, account isolation, revisions, locks and sharing. They do not claim the schema has already been applied to your project or that production email delivery works.

## Existing SQLite accounts and trips

Old SQLite accounts are separate from Supabase Auth. Users create/confirm a Supabase account; local password hashes and sessions are **not copied**. Back up the existing SQLite database before switching. If Render already discarded its ephemeral database, missing data cannot be recovered by this integration.

To retain trips, prepare a private JSON mapping of local workspace UUIDs to confirmed Supabase user UUIDs. Verify ownership manually; do not automatically match an unverified old email to a new account. Keep this mapping and database backup out of GitHub.

```sh
node scripts/migrate-supabase.mjs --database /private/backup.sqlite --mapping /private/user-map.json
# Review the dry run; set Supabase settings and the server secret locally, then:
node scripts/migrate-supabase.mjs --database /private/backup.sqlite --mapping /private/user-map.json --apply
```

The script skips existing same-ID trips, preserves saved reports/history, enforces 50 trips/account and does not import public-share links. Partial imports can be resumed. It never prints passwords or tokens. The original SQLite file is read-only and left intact.
