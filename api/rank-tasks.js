// Vercel serverless function — ranks the open task list with Claude.
// Requires env var ANTHROPIC_API_KEY (already set in Vercel for parse-receipt.js).
// The key NEVER reaches the browser; it only lives here on the server.
//
// NOTE: the sister install (Dwellbusinesssuite PR #3) DELETED this endpoint as
// live, LLM-calling and called by nothing. Here it is genuinely called, from
// the Tasks screen (src/App.jsx). So it is guarded, not removed.
import { guard, sweep } from '@proytech/core/guard';
import { checkBudget, recordSpend } from '@proytech/core/budget';

export default async function handler(req, res) {
  // guard() handles OPTIONS and the POST-only check itself.
  const gate = await guard(req, res, {
    name: 'rank-tasks', perIp: 30, windowMin: 10, perDay: 900,
    maxChars: 120000, requireAuth: true,
  });
  if (!gate.ok) return;
  sweep();

  // One ceiling for the whole install, checked before we spend. See _budget.js.
  const over = await checkBudget();
  if (over) { res.status(over.status).json(over.body); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(200).json({ ok: false, error: 'AI not configured' }); return; }

  try {
    const { tasks, context } = req.body || {};
    if (!Array.isArray(tasks) || !tasks.length) { res.status(200).json({ ok: false, error: 'No tasks provided' }); return; }

    const list = tasks.map(t => ({
      id: t.id,
      title: t.title || '',
      notes: t.notes || '',
      owner: t.owner || 'Both',
      lead: t.lead || '',
      due: t.due || '',
      revenue: Number(t.revenue) || 3,
      urgency: Number(t.urgency) || 3,
      effort: Number(t.effort) || 3,
    }));

    const today = new Date().toISOString().slice(0, 10);
    const prompt =
      'You are the chief of staff for a mortgage loan officer. '
      + 'The mission is to fund more loans and protect deals in progress. Rank the open tasks from most to least important to that goal.\n\n'
      + 'Scoring rules:\n'
      + '- Core score = revenue/deal impact (1-5) times urgency (1-5).\n'
      + '- Break ties by effort: lower effort ranks higher.\n'
      + '- Deal weighting: a task tied to a specific borrower/loan, an expiring pre-approval or rate lock, or a stuck loan outranks internal or admin work.\n'
      + '- A task whose due date is near or already past (today is ' + today + ') jumps up.\n'
      + (context ? ('- Extra context: ' + context + '\n') : '')
      + '\nTasks (JSON):\n' + JSON.stringify(list)
      + '\n\nRespond with ONLY minified JSON, no markdown, no prose: {"ranking":[{"id":string,"reason":string}]} ordered best-first. '
      + 'reason is a punchy 4-9 word explanation of why it ranks there. Include every task id exactly once.';

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      // Haiku is ~3x cheaper than Sonnet ($1/$5 vs $3/$15 per Mtok) and plenty for
      // extraction/ranking. If output quality ever slips, swap back to 'claude-sonnet-4-6'.
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] }),
    });
    if (!r.ok) { const t = await r.text(); res.status(200).json({ ok: false, error: 'AI request failed', detail: t.slice(0, 300) }); return; }
    const data = await r.json();
    // Bill it to the shared ledger before we shape the reply — the tokens are
    // spent either way, and an unrecorded call is a hole in the ceiling.
    await recordSpend('claude-haiku-4-5-20251001', data && data.usage);
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').replace(/```json|```/g, '').trim();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    if (!parsed || !Array.isArray(parsed.ranking)) { res.status(200).json({ ok: false, error: 'Could not parse AI output' }); return; }
    res.status(200).json({ ok: true, ranking: parsed.ranking });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
}
