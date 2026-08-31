-- ============================================================================
-- SECURITY-MIGRATION.sql — what api/_guard.js and api/_spend.js need.
--
-- Run this ONCE in Supabase → SQL Editor, on top of SETUP.sql. Idempotent and
-- safe to re-run.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- Until now every route under /api was reachable by anyone with the URL. Six of
-- them call api.anthropic.com on a key billed to whoever deployed this. The
-- guard needs somewhere to keep its counters, and Vercel functions are
-- stateless — there is no shared memory between invocations, and an in-memory
-- counter resets on every cold start, which is exactly when you are being hit
-- hardest. So the state lives here.
--
-- RUN THIS BEFORE DEPLOYING THE GUARDED CODE. The order matters and the failure
-- is quiet: without api_hits, the rate limiter fails OPEN (deliberately — a
-- limiter that takes the site down when its own datastore blips is worse than
-- the abuse it prevents), and without the `cost` column the dollar ceiling in
-- _spend.js is silently skipped. Both look exactly like "it works".
-- ============================================================================

-- ---------------------------------------------------------------- api_hits
-- One row per guarded call. Two kinds of row live here:
--   cost IS NULL     — a rate-limit tick, swept after 48h by _guard.sweep()
--   cost IS NOT NULL — a spend ledger entry, summed per calendar month and
--                      NEVER swept, because the monthly bill depends on it
create table if not exists api_hits (
  id     bigserial   primary key,
  bucket text        not null,
  at     timestamptz not null default now(),
  cost   numeric(10,6)
);

-- Added separately so this file also repairs an install that created api_hits
-- from an older copy of the table without the money column.
alter table api_hits add column if not exists cost numeric(10,6);

comment on column api_hits.cost is
  'USD cost of a single AI call. Null for plain rate-limit rows. Summed per calendar month by api/_spend.js to enforce JARVIS_BUDGET.';

create index if not exists api_hits_bucket_at on api_hits (bucket, at desc);
create index if not exists api_hits_cost_at
  on api_hits (bucket, at desc) where cost is not null;

-- Written only by the service key from serverless functions. RLS on with NO
-- policy means no anon or authenticated client can touch it; the service key
-- bypasses RLS by design.
alter table api_hits enable row level security;

-- ------------------------------------------------------------ crm_users.active
-- _guard.isManager() refuses a deactivated account. SETUP.sql predates the
-- column, so add it here rather than editing that file — an install that has
-- already run SETUP.sql must be repairable by running this.
alter table crm_users add column if not exists active boolean not null default true;

-- ---------------------------------------------------------------- crm_whoami
-- "What am I?" answered by Postgres from auth.uid(), not by the caller.
--
-- This is the whole point: a role in a request body is a CLAIM. The browser can
-- write anything it likes there. This function derives the role from the JWT's
-- subject inside the database, as security definer, so a caller cannot assert
-- their own role — and it is the only thing _guard.js will accept as proof.
--
-- The empty-roster case matters and is easy to get wrong. Before anyone is
-- added, `crm_users` is empty and RLS means a signed-in user can only ever SEE
-- their own row — so "no manager rows visible" and "no managers exist" look
-- identical from the browser. Returning 'manager' while the roster is empty is
-- what lets the first person set the install up; `setup` says which case it is.
drop function if exists crm_whoami();
create or replace function crm_whoami()
returns table (role text, active boolean, setup boolean, name text, pools text[])
language sql security definer stable as $$
  select
    coalesce(u.role, case when exists (select 1 from crm_users) then 'none' else 'manager' end),
    coalesce(u.active, true),
    exists (select 1 from crm_users),
    u.name,
    coalesce(u.pools, '{}')
  from (select 1) _ left join crm_users u on u.id = auth.uid();
$$;
revoke all on function crm_whoami() from public, anon;
grant execute on function crm_whoami() to authenticated;

-- ============================================================================
-- VERIFY — run these after, and read the answers rather than assuming.
--
--   select * from crm_whoami();
--     signed in as a manager  → role 'manager', active t, setup t
--     signed in as an officer → role 'officer'
--
--   select bucket, count(*), round(sum(cost)::numeric, 4) as usd
--     from api_hits where at >= date_trunc('month', now()) group by bucket;
--     after a few AI calls this should have rows. If it is empty while the
--     assistant works, the guard is failing open — check SUPABASE_SERVICE_KEY
--     on the deployment, and the [guard] lines in the Vercel function logs.
-- ============================================================================
