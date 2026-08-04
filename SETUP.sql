-- ============================================================================
-- ProyTech CRM — FULL SETUP for a BRAND-NEW Supabase project (Triple J Mortgage)
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Idempotent and safe to re-run. Creates leads, app_settings, crm_users, and
-- secrets (Google token store), all with row-level security configured.
-- ============================================================================

-- 0) Base tables the app stores everything in (leads as jsonb rows + one
--    shared settings row). A fresh project doesn't have these yet.
create table if not exists leads (
  id   uuid primary key,
  data jsonb not null default '{}'::jsonb
);
create table if not exists app_settings (
  id   text primary key,
  data jsonb not null default '{}'::jsonb
);
-- Server-only store for the Google Calendar/Gmail refresh token. RLS is
-- enabled with NO policies below, so the browser (anon/publishable key)
-- can never read or write it — only the service-role key on the server can.
create table if not exists secrets (
  id   text primary key,
  data jsonb not null default '{}'::jsonb
);

-- 1) Roster: one row per person (id = their Supabase Auth uid)
create table if not exists crm_users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'officer',      -- 'manager' | 'officer'
  pools text[] not null default '{}'
);

-- 2) Real columns on leads for RLS to enforce on (beside the jsonb `data`)
alter table leads add column if not exists owner_id uuid references auth.users(id);
alter table leads add column if not exists pool text;

-- 3) SECURITY DEFINER helpers (avoid recursion when a crm_users policy reads crm_users)
create or replace function is_manager() returns boolean
  language sql security definer stable as $$
  select exists (select 1 from crm_users where id = auth.uid() and role = 'manager');
$$;
create or replace function my_pools() returns text[]
  language sql security definer stable as $$
  select coalesce((select pools from crm_users where id = auth.uid()), '{}');
$$;
create or replace function no_users() returns boolean
  language sql security definer stable as $$
  select not exists (select 1 from crm_users);
$$;

-- 4) Enable RLS
alter table leads enable row level security;
alter table crm_users enable row level security;
alter table app_settings enable row level security;
alter table secrets enable row level security;
-- no policies on secrets, on purpose: only the service-role key bypasses RLS.

-- 5) Leads policy: empty roster → single-tenant (everyone signed in sees all);
--    else manager sees all, officer sees own + their pools.
drop policy if exists leads_all on leads;
create policy leads_all on leads for all using (
  no_users() or is_manager() or owner_id = auth.uid()
  or (pool is not null and pool = any (my_pools()))
) with check (
  no_users() or is_manager() or owner_id = auth.uid()
  or (pool is not null and pool = any (my_pools()))
);

-- 6) crm_users policies
drop policy if exists users_read on crm_users;
create policy users_read on crm_users for select using (id = auth.uid() or is_manager());
drop policy if exists users_manage on crm_users;
create policy users_manage on crm_users for all using (is_manager()) with check (is_manager());

-- 7) app_settings: login-gated read for any signed-in user; write manager-only
--    (or an empty roster). If officers must save their own tasks, change the
--    settings_write USING/CHECK to `auth.uid() is not null`.
drop policy if exists settings_read on app_settings;
create policy settings_read on app_settings for select using (auth.uid() is not null);
drop policy if exists settings_write on app_settings;
create policy settings_write on app_settings for all
  using (no_users() or is_manager()) with check (no_users() or is_manager());

-- 8) One-time backfill of owner_id from data.owner → crm_users.name (no-op while
--    the roster is empty; the Team screen re-runs this after you add people).
update leads l set owner_id = u.id
  from crm_users u
 where l.owner_id is null and (l.data ->> 'owner') = u.name;

-- Done. Grab Project URL + anon (publishable) key from Settings → API.
