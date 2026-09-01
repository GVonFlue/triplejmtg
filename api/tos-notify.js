// Vercel serverless function — emails Garrett when someone signs the in-app
// Terms of Service. The signature itself is already durably stored in Supabase
// (app_settings row id='tos') by the browser before this is called — this is
// just a courtesy notification, so it fails silently and never blocks signing.
// Requires env var RESEND_API_KEY (https://resend.com — free tier is plenty for
// this volume). Optional TOS_NOTIFY_EMAIL overrides the default recipient.
import { guard, sweep } from '@getproytech/core/guard';

export default async function handler(req, res) {
  // Signed-in only: the signature it reports is already written to
  // app_settings by an authenticated browser before this is called.
  // guard() handles OPTIONS and the POST-only check itself.
  const gate = await guard(req, res, {
    name: 'tos-notify', perIp: 5, windowMin: 10, perDay: 200,
    maxChars: 4000, requireAuth: true,
  });
  if (!gate.ok) return;
  sweep();

  const key = process.env.RESEND_API_KEY;
  if (!key) { res.status(200).json({ ok: false, error: 'Email not configured (RESEND_API_KEY unset) — signature is still saved in the database.' }); return; }

  try {
    const { name, email, uid, signedAt } = req.body || {};
    if (!name) { res.status(400).json({ ok: false, error: 'name required' }); return; }
    const to = process.env.TOS_NOTIFY_EMAIL || 'admin@getproytech.com';
    const when = signedAt ? new Date(signedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' }) + ' CT' : 'just now';

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        from: process.env.TOS_NOTIFY_FROM || 'ProyTech CRM <onboarding@resend.dev>',
        to: [to],
        subject: `Terms of Service signed — ${name}`,
        text:
          `${name} signed the Terms of Service in the Triple J Mortgage CRM.\n\n` +
          `Name: ${name}\n` +
          `Account email: ${email || '(unknown)'}\n` +
          `Signed at: ${when}\n` +
          `User id: ${uid || '(unknown)'}\n`,
      }),
    });
    if (!r.ok) { const t = await r.text(); res.status(200).json({ ok: false, error: 'send failed', detail: t.slice(0, 300) }); return; }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
}
