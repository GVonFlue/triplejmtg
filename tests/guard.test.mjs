/* ============================================================================
   tests/guard.test.mjs — is THIS repo wired to the shared platform correctly?

   WHAT MOVED, AND WHY THIS FILE SHRANK.
   -------------------------------------
   The behaviour of the guard and the spend ceiling — 401 on a missing token,
   403 on a wrong role, failing closed on an unreadable ledger, the rate card —
   is now tested in @getproytech/core, once, against all three installs' rules. It
   was tested here too, in a copy, and that copy would have drifted from the
   package the first time either changed. Duplicated tests are the same problem
   as duplicated code, one layer up.

   WHAT STAYED IS WHAT ONLY THIS REPO CAN GET WRONG:

     * a route that forgets to call guard() at all — the exact state this repo
       was in, with fifteen functions open to the internet
     * a route reaching for the deleted local copies instead of the package
     * a frontend call site that does not send the token, which is what would
       have turned "secured" into "every AI feature broken"

   Run with: npm test
   ========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(ROOT, 'api');

/** Routes Vercel exposes: every .js in api/ that does not start with _. */
const routes = () => readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_'));

/* google-callback.js is the one deliberate exception. It is the redirect URI
   registered in Google Cloud and is hit by Google's own servers, which cannot
   carry a Supabase token — guard() would 401 the OAuth handshake itself. Listed
   by name so adding a second exception is a decision somebody has to write
   down, rather than something that quietly happens. */
const UNGUARDED_ON_PURPOSE = new Set(['google-callback.js']);

test('every route calls guard(), or is an admitted exception', () => {
  const open = routes().filter(f =>
    !UNGUARDED_ON_PURPOSE.has(f) && !/\bguard\(/.test(readFileSync(join(API, f), 'utf8')));
  assert.deepEqual(open, [],
    `these routes are reachable by anyone with the URL: ${open.join(', ')}`);
});

test('every AI route checks the budget before it spends', () => {
  const spending = routes().filter(f => readFileSync(join(API, f), 'utf8').includes('api.anthropic.com'));
  assert.ok(spending.length >= 6, 'expected the six known AI routes; did one get renamed?');
  const unmetered = spending.filter(f => !readFileSync(join(API, f), 'utf8').includes('checkBudget'));
  assert.deepEqual(unmetered, [],
    `these call Anthropic without asking the ceiling first: ${unmetered.join(', ')}`);
});

test('nothing imports the deleted local copies', () => {
  // _guard.js, _env.js, _spend.js and _budget.js now live in @getproytech/core.
  // A leftover relative import would resolve to nothing and fail at runtime, in
  // production, on the first request rather than at build time.
  for (const f of readdirSync(API).filter(n => n.endsWith('.js'))) {
    const src = readFileSync(join(API, f), 'utf8');
    assert.doesNotMatch(src, /from '\.\/_(guard|env|spend|budget)\.js'/,
      `api/${f} still imports a local platform file that no longer exists`);
  }
});

test('platform code is imported from the package, not re-copied', () => {
  const local = readdirSync(API).filter(f => ['_guard.js', '_env.js', '_spend.js', '_budget.js'].includes(f));
  assert.deepEqual(local, [],
    `these are back as local copies and will drift from the package: ${local.join(', ')}`);
});

test('no route asks for a role by name', () => {
  // Which role is an admin is ADMIN_ROLES on the deployment. A hardcoded name
  // here is the bug that shipped into Dwell asking for 'owner' and matching
  // nobody — it does not error, it just refuses everyone, quietly, for months.
  for (const f of routes()) {
    const src = readFileSync(join(API, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(src, /requireManager|requireOwner|requireLeader/,
      `api/${f} names a role in code — use requireAdmin and set ADMIN_ROLES`);
  }
});

test('no browser call to /api bypasses the token helper', () => {
  // api() in src/lib/supabase.js attaches the Supabase access token. A bare
  // fetch to a guarded route is a 401 the screen renders as nothing at all,
  // because these endpoints answer 200 with { ok:false } for most failures.
  const src = readFileSync(join(ROOT, 'src', 'App.jsx'), 'utf8');
  const bare = [...src.matchAll(/fetch\(\s*['"`]\/api\//g)];
  assert.equal(bare.length, 0,
    `${bare.length} call site(s) use a bare fetch to /api — route them through api()`);
});

test('the .npmrc that resolves the private package is committed', () => {
  // Without it npm falls through to PUBLIC npm. The @getproytech scope IS ours
  // there, which is what keeps that fall-through a clean 404 rather than an
  // install of somebody else's code next to a service key — and it is why
  // nothing named 'core' is published publicly: a real-but-empty package would
  // turn this loud build failure into a green deploy that 500s at runtime.
  const npmrc = readFileSync(join(ROOT, '.npmrc'), 'utf8');
  assert.match(npmrc, /@getproytech:registry=https:\/\/npm\.pkg\.github\.com/);
  assert.match(npmrc, /_authToken=\$\{NPM_TOKEN\}/,
    'the token must come from the environment, never be committed');
  assert.doesNotMatch(npmrc, /ghp_|github_pat_/, 'a real token is committed in .npmrc');
});
