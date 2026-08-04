// Agentic AI Tools for the loan officer. The browser sends the relevant lead data
// (it already knows how to filter "not contacted in 45 days" etc.); this endpoint
// does the writing/thinking with Claude and returns structured output.
//   POST { tool:'draft_email', lead, kind }        -> { ok, subject, body }
//   POST { tool:'call_list', leads }               -> { ok, items:[{name,reason}] }
//   POST { tool:'brief', lead }                     -> { ok, text }
// ANTHROPIC_API_KEY is server-only and never reaches the browser.

async function claude(key, { system, user, max = 700 }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: max, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error('AI request failed (' + r.status + ')');
  const d = await r.json();
  return (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
}
const parseJson = t => { try { return JSON.parse(t.replace(/```json|```/g, '').trim()); } catch { return null; } };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST only' }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(200).json({ ok: false, error: 'AI not configured' }); return; }
  try {
    const b = req.body || {};
    const officer = (b.officer || 'your loan officer');

    if (b.tool === 'draft_email') {
      const l = b.lead || {};
      const kindLine = ({
        cold: 'This borrower has gone quiet — write a warm, low-pressure re-engagement email that reopens the conversation.',
        preapproval: 'This borrower\'s pre-approval is expiring soon — write a helpful heads-up email offering to refresh it or move forward.',
        refi: 'Rates may have improved — write a short email letting this past client know it may be worth looking at a refinance.',
        recap: 'Write a friendly recap email after a recent conversation, restating next steps.',
      })[b.kind] || 'Write a helpful, personal outreach email to this borrower.';
      const system = 'You write short, warm, professional emails for a mortgage loan officer. Personal, plain, never pushy or spammy. No made-up facts, rates, or numbers. 90-140 words. Use the borrower\'s notes to make it specific. Return ONLY minified JSON: {"subject":string,"body":string}. The body must end with a signature line "— ' + officer + '".';
      const user = kindLine + '\nBorrower JSON: ' + JSON.stringify({
        name: l.name, purpose: l.loanPurpose, loanType: l.loanType, amount: l.dealValue,
        lastContact: l.lastContact, notes: (l.note || l.nextSteps || ''), stage: l.stageLabel,
      });
      const out = parseJson(await claude(key, { system, user, max: 600 }));
      if (!out || !out.body) { res.status(200).json({ ok: false, error: 'Could not draft that email' }); return; }
      res.status(200).json({ ok: true, subject: out.subject || 'Following up', body: out.body });
      return;
    }

    if (b.tool === 'call_list') {
      const list = (b.leads || []).slice(0, 40);
      const system = 'You are a chief-of-staff for a mortgage loan officer. Rank who to call today to move the pipeline and protect deals. Prioritize: expiring pre-approvals/rate locks, hot leads gone cold, and loans stuck in a stage. Return ONLY minified JSON {"items":[{"name":string,"reason":string}]} best-first, reason 4-9 words. Include only the most important; skip the rest.';
      const out = parseJson(await claude(key, { system, user: 'Leads JSON: ' + JSON.stringify(list), max: 800 }));
      if (!out || !Array.isArray(out.items)) { res.status(200).json({ ok: false, error: 'Could not rank the list' }); return; }
      res.status(200).json({ ok: true, items: out.items });
      return;
    }

    if (b.tool === 'brief') {
      const l = b.lead || {};
      const system = 'You brief a mortgage loan officer before a call. 4-6 tight bullet lines: who they are, loan snapshot, where things stand, what to do next. Plain text, one bullet per line starting with "•". No fluff, no invented facts.';
      const out = await claude(key, { system, user: 'Borrower JSON: ' + JSON.stringify(l), max: 500 });
      res.status(200).json({ ok: true, text: out });
      return;
    }

    res.status(400).json({ ok: false, error: 'unknown tool' });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
}
