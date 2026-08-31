// Dashboard "How do I…?" helper. Answers questions about USING the CRM only — it has
// no access to loan data, so it's safe and cheap. Its knowledge is the guide below.
// POST body: { question }  ->  { ok, answer }
import { guard, sweep } from '@proytech/core/guard';
import { checkBudget, recordSpend } from '@proytech/core/budget';

const GUIDE = `
You are the in-app help assistant for the ProyTech Business Suite — a CRM built for a mortgage loan officer (Triple J Mortgage). Answer ONLY questions about how to use the CRM. Keep answers short, friendly, and concrete (2-5 sentences). If asked something you can't know (a borrower's data, outside facts), say you only help with how to use the CRM. Never invent features that aren't listed here.

How the CRM works:
- Dashboard: the home screen. Top tiles = Pipeline Volume, Funded Volume, Loans Funded, Avg Loan Size. Then commission (Earned, Pipeline, Projected). Then Activity & Health tiles including Conversations, Meetings, Speed to First Touch, Follow-Up Health, Going Cold, Expiring. Then the Pipeline Status widget (every loan grouped Prospect / Processing / Closing / Funded), then the Conversion Funnel.
- Stages: a borrower flows Lead/New -> App Intake -> Qualification -> Pre-Approved (the Leads pipeline). When under contract they graduate to the Loan pipeline: Loan Setup -> Disclosed -> Submitted to UW -> Approved w/ Conditions -> Re-Submittal -> Clear to Close -> Docs Out -> Docs Signed -> Loan Funded -> Broker Check Received -> Loan Finalized.
- Add a lead: click "+ New Lead" (top right or sidebar). Fill name, loan purpose, loan amount, source, and a follow-up date.
- Log a conversation: open a lead, use the Activity Log to log a Call or Meeting. Calls and meetings count as "Conversations" on the dashboard, and the convos-per-funded ratio tells you how many it takes to fund a loan.
- Move a loan: drag its card on the Pipeline or Loans board to the next stage, or change Stage on the lead record.
- Follow-Up screen: clear everyone due or overdue each morning; expiring pre-approvals and rate locks show first.
- Commission: set a default rate in Settings; override the rate on any single loan in its record (for a rate that changes mid-year).
- Pre-approval dates: set the start and expiry on a lead; the dashboard warns when one is within 15 days of expiring.
- Import: Leads screen -> Import; upload a CSV and the AI maps the columns and creates the leads.
- Connect Google (Settings): connect Gmail and Calendar so meetings post to your calendar and the AI Tools can drop drafted emails into your Gmail drafts.
- AI Tools tab: runs tasks for you — e.g. draft re-engagement emails to cold leads, check-ins for expiring pre-approvals, "who to call today", pre-call briefs.
- Request another seat: Settings -> Your Plan & Seats -> Request a seat ($25/mo).
`;


export default async function handler(req, res) {
  // The help bot reaches no CRM data, but it does reach api.anthropic.com on
  // our key, and that is the whole reason this is not public.
  // guard() handles OPTIONS and the POST-only check itself.
  const gate = await guard(req, res, {
    name: 'ai-assistant', perIp: 30, windowMin: 10, perDay: 1000,
    maxChars: 4000, requireAuth: true,
  });
  if (!gate.ok) return;
  sweep();

  // One ceiling for the whole install, checked before we spend. See _budget.js.
  const over = await checkBudget();
  if (over) { res.status(over.status).json(over.body); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(200).json({ ok: false, error: 'AI not configured' }); return; }
  try {
    const { question } = req.body || {};
    if (!question) { res.status(400).json({ ok: false, error: 'no question' }); return; }
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 400, system: GUIDE,
        messages: [{ role: 'user', content: String(question).slice(0, 500) }],
      }),
    });
    if (!r.ok) { res.status(200).json({ ok: false, error: 'AI request failed' }); return; }
    const data = await r.json();
    // Bill it to the shared ledger before we shape the reply — the tokens are
    // spent either way, and an unrecorded call is a hole in the ceiling.
    await recordSpend('claude-haiku-4-5-20251001', data && data.usage);
    const answer = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    res.status(200).json({ ok: true, answer });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
}
