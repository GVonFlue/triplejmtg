# Deploy notes — consuming @proytech/core

Two things must be true on the deployment before this branch will work, and
neither is in the code.

## 1. ADMIN_ROLES=manager

The shared guard knows about a CAPABILITY (`requireAdmin`), not a role name.
This install's admin role is `manager`; Dwell's is `leader`; ProyTech's is
`owner`. Which one counts here is a deployment variable:

    ADMIN_ROLES=manager

**Unset means nobody is an admin.** There is deliberately no default list — a
default would mean a typo silently grants admin to whatever the default happens
to name. Unset, `/api/google?action=disconnect` answers 403 to everyone,
including Jesse, and the Vercel function log says so in one line.

## 2. NPM_TOKEN

    NPM_TOKEN=<classic PAT, read:packages only>

The committed `.npmrc` points the `@proytech` scope at GitHub Packages and reads
this from the environment. Without it the build fails with a 404 that claims the
package does not exist — see the runbook; it is a token problem, not a
publishing problem.

## 3. Run the core migration

    DATABASE_URL="postgres://..." npm run migrate

Adds `core_whoami()`, which `requireAdmin` reads. This install's own
`crm_whoami()` is left alone on purpose — it has a different shape and the app
reads it.

Check first with `npm run migrate -- --status`.
