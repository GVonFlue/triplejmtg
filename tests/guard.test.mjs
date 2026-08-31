/* ============================================================================
   tests/guard.test.mjs — the claims this change makes, checked.

   These are the assertions that would have caught the state this repo was in:
   fifteen routes reachable by anyone with the URL, six of them calling
   api.anthropic.com on a key somebody pays for.

   Run with:  node --test tests/
   No network, no database, no Supabase project. Every fetch is stubbed.
   ========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/* SET BEFORE ANY api/ MODULE IS IMPORTED.

   api/_env.js reads process.env at module-load time and every other server file
   imports its constants from there. Assigning process.env inside a test is
   therefore too late: _env.js has already resolved. Cache-busting the module
   under test does not help either, because its import of './_spend.js' resolves
   to the instance already in the graph.

   So the Supabase pair is fixed here, once, for the whole file. Only the
   variables read directly by the module under test (AI_BUDGET,
   AI_BUDGET_FAIL_OPEN) can vary per case, and those are cache-busted below. */
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'service-key';

/* --------------------------------------------------------------- harness */
function mockRes() {
  const r = { statusCode: 0, body: null, headers: {}, ended: false };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.body = b; r.ended = true; return r; };
  r.end = () => { r.ended = true; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}
const post = (body = {}, headers = {}) => ({ method: 'POST', headers, body, socket: {} });

/* Load a module with a controlled environment and a stubbed global fetch.
   Cache-busted so a case that changes AI_BUDGET gets its own constants.

   fetch is left installed on globalThis rather than restored, because it is
   read at CALL time and the returned module holds no reference to it. */
let bust = 0;
async function load(path, env = {}, fetchImpl = async () => { throw new Error('no network in tests'); }) {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  globalThis.fetch = fetchImpl;
  try {
    return await import(`../api/${path}?t=${bust++}`);
  } finally {
    for (const k of Object.keys(env)) delete process.env[k];
  }
}

/* Kept as an empty marker so each call site still reads as "with Supabase
   configured" — the actual values are pinned at the top of the file. */
const SUPA = {};

/* ============================================================ the guard */

test('guard: a request with no Authorization header is refused with 401', async () => {
  const { guard } = await load('_guard.js', SUPA);
  const res = mockRes();
  const gate = await guard(post({ question: 'hi' }), res, { name: 't', requireAuth: true });
  assert.equal(gate.ok, false);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /Sign in/i);
});

test('guard: a token Supabase rejects is refused, and the caller is not told why', async () => {
  const { guard } = await load('_guard.js', SUPA, async () => ({ ok: false, status: 401, json: async () => null }));
  const res = mockRes();
  const gate = await guard(post({}, { authorization: 'Bearer forged' }), res, { name: 't', requireAuth: true });
  assert.equal(gate.ok, false);
  assert.equal(res.statusCode, 401);
  // Vague to the caller on purpose: an attacker learns nothing about which of
  // the four possible failures they hit. The detail goes to the server log.
  assert.equal(res.body.error, 'Session expired.');
});

test('guard: auth is checked BEFORE the counters, so a stranger cannot burn the day\'s budget', async () => {
  let supabaseCalls = 0;
  const { guard } = await load('_guard.js', SUPA, async url => {
    supabaseCalls++;
    assert.ok(!String(url).includes('api_hits'), 'no counter row should be written for an unauthenticated caller');
    return { ok: false, status: 401, json: async () => null };
  });
  const res = mockRes();
  await guard(post({}, { authorization: 'Bearer forged' }), res, { name: 't', requireAuth: true });
  assert.equal(supabaseCalls, 1);
});

test('guard: a body over maxChars is refused with 413 and both numbers', async () => {
  const { guard } = await load('_guard.js', SUPA);
  const res = mockRes();
  const gate = await guard(post({ blob: 'x'.repeat(9000) }), res, { name: 't', maxChars: 500 });
  assert.equal(gate.ok, false);
  assert.equal(res.statusCode, 413);
  assert.equal(res.body.limit, 500);
  assert.ok(res.body.chars > 9000);
  assert.ok(res.body.over > 0);
});

test('guard: GET is refused — every guarded route is POST-only', async () => {
  const { guard } = await load('_guard.js', SUPA);
  const res = mockRes();
  const gate = await guard({ method: 'GET', headers: {}, socket: {} }, res, { name: 't' });
  assert.equal(gate.ok, false);
  assert.equal(res.statusCode, 405);
});

test('guard: isManager asks Postgres and does NOT trust a role in the body', async () => {
  const { isManager } = await load('_guard.js', SUPA,
    async (url, opts) => {
      assert.match(String(url), /rpc\/crm_whoami/);
      // The caller's OWN token is what crm_whoami() resolves, not the service key.
      assert.match(String(opts.headers.authorization), /Bearer officer-token/);
      return { ok: true, json: async () => [{ role: 'officer', active: true }] };
    });
  assert.equal(await isManager('officer-token'), false);
});

test('guard: isManager fails CLOSED when the role cannot be proved', async () => {
  const { isManager } = await load('_guard.js', SUPA, async () => { throw new Error('supabase down'); });
  assert.equal(await isManager('any-token'), false, 'an unprovable role is not permission');
});

/* =========================================================== the budget */

test('budget: defaults to $15 for a client install', async () => {
  const { BUDGET } = await load('_budget.js', SUPA);
  assert.equal(BUDGET, 15);
});

test('budget: AI_BUDGET overrides the default', async () => {
  const { BUDGET } = await load('_budget.js', { ...SUPA, AI_BUDGET: '40' });
  assert.equal(BUDGET, 40);
});

test('budget: refuses once the month is spent, and says so in words a user understands', async () => {
  const { checkBudget } = await load('_budget.js', SUPA,
    async () => ({ ok: true, text: async () => JSON.stringify([{ cost: 9 }, { cost: 6.5 }]) }));
  const over = await checkBudget();
  assert.ok(over, 'a $15.50 month against a $15 cap must be refused');
  assert.equal(over.body.capped, true);
  assert.equal(over.body.spent, 15.5);
  assert.match(over.body.error, /resets on the 1st/);
  assert.match(over.body.error, /Everything else in the CRM works/,
    'the message must tell them the rest of the app still works');
});

test('budget: allows a call while there is room left', async () => {
  const { checkBudget } = await load('_budget.js', SUPA,
    async () => ({ ok: true, text: async () => JSON.stringify([{ cost: 3.2 }]) }));
  assert.equal(await checkBudget(), null);
});

test('budget: FAILS CLOSED when the ledger cannot be read', async () => {
  // This is the case the sister install decides the other way. An unreadable
  // ledger means we do not know what has been spent; on a client's key that
  // must not resolve to "spend more".
  const { checkBudget } = await load('_budget.js', SUPA, async () => { throw new Error('supabase down'); });
  const over = await checkBudget();
  assert.ok(over, 'an unreadable ledger must refuse, not allow');
  assert.equal(over.body.capped, true);
  assert.match(over.body.error, /Nothing has been charged/);
});

test('budget: AI_BUDGET_FAIL_OPEN=true restores the old behaviour, deliberately', async () => {
  const { checkBudget } = await load('_budget.js', { ...SUPA, AI_BUDGET_FAIL_OPEN: 'true' },
    async () => { throw new Error('supabase down'); });
  assert.equal(await checkBudget(), null);
});

/* NOT TESTED HERE, deliberately: the "no Supabase credentials at all" branch of
   checkBudget(). _env.js resolves those at module-load time for the whole
   process, so exercising it needs a child process with a different environment,
   not a re-import. It is a three-line branch that returns the same shape as the
   unreadable-ledger case above, which IS covered. Worth a child-process test
   when this file grows one; noted rather than silently skipped. */

test('budget: the overshoot past the cap is bounded by one call, not unbounded', async () => {
  const { MAX_CALL, BUDGET } = await load('_budget.js', SUPA);
  // The check happens before the call, so the call that crosses the line still
  // runs. This asserts the documented bound is a real number and a small one.
  assert.ok(MAX_CALL > 0 && MAX_CALL <= 0.25);
  assert.ok(MAX_CALL / BUDGET < 0.02, 'worst-case overshoot must be under 2% of the budget');
});

/* ============================================================ the rates */

test('spend: costOf prices a cached read at a tenth of fresh input', async () => {
  const { costOf } = await load('_spend.js', SUPA);
  const fresh = costOf('claude-haiku-4-5-20251001', { input_tokens: 1e6 });
  const cached = costOf('claude-haiku-4-5-20251001', { cache_read_input_tokens: 1e6 });
  assert.equal(fresh, 1);
  assert.ok(Math.abs(cached - 0.1) < 1e-9);
});

test('spend: an unknown model still costs something, rather than nothing', async () => {
  const { costOf } = await load('_spend.js', SUPA);
  // A model id we do not have a rate card for must not silently price at zero —
  // that is a hole in the ceiling that opens the day a model is renamed.
  assert.ok(costOf('claude-some-future-model', { input_tokens: 1e6, output_tokens: 1e6 }) > 0);
});
