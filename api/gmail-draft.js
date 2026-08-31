// Creates a DRAFT in the connected Google account's Gmail (never sends — the loan
// officer reviews and sends it himself). Reuses the same OAuth connection as Calendar.
// POST body: { to, subject, body, fromName? }  ->  { ok, draftId } | { ok:false, error }
import { guard, sweep } from './_guard.js';
import { getAccessToken } from './_google.js';

// RFC-2047 encode a header value that may contain non-ASCII (names, subjects).
function enc(s) { return '=?UTF-8?B?' + Buffer.from(String(s || ''), 'utf8').toString('base64') + '?='; }
const b64url = buf => Buffer.from(buf, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export default async function handler(req, res) {
  // Unauthenticated this created drafts in the connected Gmail account.
  // guard() handles OPTIONS and the POST-only check itself.
  const gate = await guard(req, res, {
    name: 'gmail-draft', perIp: 30, windowMin: 10, perDay: 600,
    maxChars: 60000, requireAuth: true,
  });
  if (!gate.ok) return;
  sweep();

  try {
    const token = await getAccessToken();
    if (!token) { res.status(200).json({ ok: false, error: 'not_connected' }); return; }
    const { to, subject, body } = req.body || {};
    if (!body) { res.status(400).json({ ok: false, error: 'body required' }); return; }

    const headers = [
      to ? `To: ${to}` : 'To: ',
      `Subject: ${enc(subject || '')}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
    ].join('\r\n');
    const raw = b64url(headers + '\r\n\r\n' + body);

    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { raw } }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { res.status(200).json({ ok: false, error: j.error?.message || 'draft failed' }); return; }
    res.status(200).json({ ok: true, draftId: j.id || (j.message && j.message.id) || null });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
}
