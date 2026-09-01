# Deploy notes — consuming @getproytech/core

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

## 4. MODULES — what this install bought

    MODULES=leads,tasks,assistant,huddle,books

The ceiling. Only the operator can change it, because only the operator has the
Vercel project. `settings.modules` shapes the install *within* it and can never
widen it — which matters, because a leader has write access to `app_settings` by
design, so a gate that lived only there would be an upgrade button.

**Unset means no ceiling** and every module is allowed. That is the right
default for an install that predates tiering, and the opposite of `ADMIN_ROLES`,
where unset means nobody is an admin. One is a product decision, the other is a
permission.

`VITE_MODULES` is accepted as the same variable — the browser already reads that
name to hide the tab, and two variables would drift invisibly.

### Upgrading a client mid-month

1. Vercel → project → Settings → Environment Variables → edit `MODULES`, add the
   keys. Apply to Production **and** Preview.
2. Deployments → the current production deployment → **Redeploy**.
3. Tell them to reload.

Roughly two minutes, no code change, no migration. The redeploy is required and
not optional: `VITE_MODULES` is compiled into the browser bundle at build time,
so changing the variable alone leaves the old bundle serving the old sidebar.
The server half picks it up the moment the new deployment goes live.

Downgrading is the same three steps in reverse, and takes effect the same way.
