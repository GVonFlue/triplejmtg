import { costOf, spentThisMonth, logSpend } from './_spend.js';
import { SUPA_KEY, SUPA_URL } from './_env.js';
/* ============================================================================
   _budget.js — ONE dollar ceiling for the WHOLE install.

   WHAT THIS CHANGES ABOUT THE SISTER INSTALL'S VERSION, AND WHY
   -------------------------------------------------------------
   GVonFlue/proytech-crm meters four of its eleven Anthropic-calling endpoints
   and gives JARVIS its own bucket. That is the right shape for a CRM you run
   yourself: you watch the bill, and the cap is a seatbelt.

   It is the wrong shape for a CLIENT install, for two reasons:

     1. A PER-ENDPOINT CAP IS NOT A BILL. "$15 on jarvis" says nothing about
        what ai-tools, huddle, import-leads, parse-receipt and rank-tasks spent
        alongside it. Every route here shares ONE bucket — 'ai:spend' — so the
        number the cap is enforcing is the number that arrives on the invoice.

     2. FAILING OPEN ON SPEND IS A DECISION THAT BELONGS TO WHOEVER PAYS.
        The rate limiter in _guard.js fails open on purpose, and that is right:
        a limiter that takes the product down when its own datastore blips is
        worse than the abuse it prevents. A SPEND cap is not that. If the ledger
        is unreachable we cannot know what has been spent, and "unknown" must
        not resolve to "spend more" on someone else's card.

        So this fails CLOSED by default. AI_BUDGET_FAIL_OPEN=true restores the
        old behaviour for an install that would rather have a working assistant
        than a bounded bill — a real choice, made deliberately, not a default.

   WHAT THIS IS NOT
   ----------------
   It is not a hard ceiling on the invoice, and calling it one would be a lie.
   The check happens BEFORE a call, so the call that crosses the line still
   completes. The overshoot is bounded by the most expensive single request the
   guard will accept — see MAX_CALL below — not by zero. Budget accordingly:
   the cap lands the month a little over the number, never wildly over it.

   Nor does it cover spend outside this app. If the same Anthropic key is used
   anywhere else, this ledger cannot see it. One key per client install.
   ========================================================================== */

/* Dollars per calendar month, across every AI endpoint in this deployment.
   $15 is the per-client default; the operator's own install runs higher. */
export const BUDGET = Number(process.env.AI_BUDGET) > 0 ? Number(process.env.AI_BUDGET) : 15;

/* One bucket for the whole install. Deliberately not per-endpoint. */
export const BUCKET = 'ai:spend';

const FAIL_OPEN = String(process.env.AI_BUDGET_FAIL_OPEN || '').toLowerCase() === 'true';

/* The worst single call this deployment will accept, in dollars, so the
   overshoot above is a number rather than a shrug. The biggest body guard()
   allows on a text route is 120k characters (rank-tasks) ≈ 33k tokens; the
   most expensive model in use is Sonnet at $3/M in, $15/M out, and the largest
   max_tokens is 3000. 33k*3/1e6 + 3000*15/1e6 ≈ $0.15. parse-receipt accepts a
   5MB base64 body, but images bill by resized pixel area, not base64 length,
   and it runs on Haiku with max_tokens 600 — well under the same figure.
   Rounded up hard, because being wrong in this direction is the cheap way. */
export const MAX_CALL = 0.25;

/** Ask before spending. Returns null when the caller may proceed, or a ready
 *  {status, body} to send back when it may not.
 *
 *  Call it AFTER guard() — a caller who is not allowed in should not be able to
 *  consume the ledger read on their way to being turned away. */
export async function checkBudget() {
  if (!SUPA_URL || !SUPA_KEY) {
    /* No ledger is configured at all. On a client install this is a setup
       error, not a state to spend through: SECURITY-MIGRATION.sql has not been
       run, or the service key is missing. Loud on the server, honest to the
       caller. */
    console.error('[budget] no Supabase credentials on this deployment — the AI '
      + 'spend ceiling cannot be enforced. Set SUPABASE_URL and '
      + 'SUPABASE_SERVICE_ROLE_KEY, and run SECURITY-MIGRATION.sql.');
    if (FAIL_OPEN) return null;
    return {
      status: 200,
      body: {
        ok: false, capped: true, budget: BUDGET,
        error: 'The AI features are not configured on this install yet. Nothing has been charged.',
      },
    };
  }

  const spent = await spentThisMonth(BUCKET);

  if (spent === null) {
    /* The ledger exists but could not be read: Supabase blip, or the `cost`
       column is missing because the migration has not run. Either way we do not
       know what has been spent this month. */
    console.error(`[budget] could not read the spend ledger (bucket=${BUCKET}). `
      + `${FAIL_OPEN ? 'AI_BUDGET_FAIL_OPEN is set, so the call is being ALLOWED.'
                     : 'Refusing the call rather than spending an unknown amount.'} `
      + 'Check that SECURITY-MIGRATION.sql has run and api_hits.cost exists.');
    if (FAIL_OPEN) return null;
    return {
      status: 200,
      body: {
        ok: false, capped: true, budget: BUDGET,
        error: 'The AI assistant is briefly unavailable. Nothing has been charged — try again in a few minutes.',
      },
    };
  }

  if (spent >= BUDGET) {
    return {
      status: 200,
      body: {
        ok: false, capped: true, budget: BUDGET,
        spent: Math.round(spent * 100) / 100,
        error: `This month's AI budget of $${BUDGET} is used up. It resets on the 1st. `
             + `Everything else in the CRM works as normal.`,
      },
    };
  }

  return null;
}

/** Record what a call cost, against the shared bucket.
 *
 *  Best effort by necessity — the tokens are already spent and failing the
 *  user's request now would charge them twice for one answer. But a write that
 *  quietly never lands means the ledger reads low forever and the ceiling stops
 *  meaning anything, so a failure is at least LOUD on the server. */
export async function recordSpend(model, usage) {
  const cost = costOf(model, usage);
  if (!(cost > 0)) return 0;
  try {
    await logSpend(BUCKET, cost);
  } catch (e) {
    console.error(`[budget] FAILED TO RECORD $${cost.toFixed(4)} of AI spend — `
      + `the monthly ceiling is now reading low by at least that much. ${e && e.message}`);
  }
  return cost;
}

/** What the browser should be told after a successful call, so the UI can show
 *  the meter rather than surprising someone at $15. */
export async function budgetState() {
  const spent = await spentThisMonth(BUCKET);
  return spent === null ? { budget: BUDGET } : { budget: BUDGET, spent: Math.round(spent * 100) / 100 };
}
