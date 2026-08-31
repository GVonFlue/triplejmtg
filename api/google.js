// Combines google-auth / google-status / google-disconnect into ONE serverless
// function, branched on ?action=. Vercel's Hobby plan caps a deployment at 12
// Serverless Functions; this project was sitting right at that limit, so three
// tiny always-fast endpoints were merged into one rather than paying for Pro.
// (google-callback.js stays its OWN file on purpose — its exact path
// /api/google-callback is registered as the redirect URI in Google Cloud, so
// changing that path would mean re-configuring the OAuth client too.)
//
// SECURITY. Two of the three actions here now require a session; ?action=auth
// deliberately does not, and the asymmetry is the point:
//
//   status     returns the EMAIL of the Google account this whole install
//              writes to — a real person's inbox. Unauthenticated that is a
//              working endpoint for harvesting the owner's address off any
//              deployment, needing no knowledge of the CRM at all.
//   disconnect severs the ONE Google connection for the whole install. There is
//              no per-user connection here. Unauthenticated it was a one-line
//              denial of service on the URL alone; merely signed-in would still
//              let any officer switch the feature off for everyone.
//   auth       is a browser REDIRECT. It cannot carry an Authorization header,
//              so guard() cannot apply, and it is left open on purpose. It
//              leaks nothing: it bounces you to Google's own consent screen.
//              (The missing OAuth `state` parameter is a separate, real gap —
//              fixing it touches google-callback.js and the stored-config
//              format, so it is not bundled into this change.)
//
// NOTE: api/google-auth.js, api/google-status.js and api/google-disconnect.js
// were deleted with this change. They were unreferenced duplicates of the three
// branches below — the merge described above added google.js but never removed
// the originals, so they were still deployed, still routable, and still open.
import { guard, sweep } from './_guard.js';
import { OAUTH_SCOPES, redirectUri, loadGoogle, clearGoogle } from './_google.js';

async function doAuth(req, res) {
  const cid = process.env.GOOGLE_CLIENT_ID;
  if (!cid) { res.status(500).send('GOOGLE_CLIENT_ID not set'); return; }
  const params = new URLSearchParams({
    client_id: cid,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: OAUTH_SCOPES,
    access_type: 'offline',   // gives us a refresh token
    prompt: 'consent',        // force refresh token even on re-consent
    include_granted_scopes: 'true',
  });
  res.writeHead(302, { Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString() });
  res.end();
}

async function doStatus(req, res) {
  // POST rather than GET so it goes through the same guard() as everything
  // else. guard() is POST-only by design, and a second bespoke auth path for
  // one status read is exactly the kind of parallel system worth refusing:
  // one implementation of "is this a real session", not two.
  // Every signed-in user may ask — an officer needs to know whose calendar a
  // booking lands on. Signed-in, not manager.
  const gate = await guard(req, res, {
    name: 'google-status', perIp: 60, windowMin: 10, perDay: 5000,
    maxChars: 2000, requireAuth: true,
  });
  if (!gate.ok) return;
  sweep();
  try {
    const g = await loadGoogle();
    res.status(200).json({ connected: !!(g && g.refresh_token), email: (g && g.email) || '' });
  } catch (e) {
    res.status(200).json({ connected: false, email: '', error: e.message });
  }
}

async function doDisconnect(req, res) {
  // requireManager implies requireAuth. Tiny body: an action with no arguments.
  const gate = await guard(req, res, {
    name: 'google-disconnect', perIp: 10, windowMin: 10, perDay: 100,
    maxChars: 500, requireManager: true,
  });
  if (!gate.ok) return;
  sweep();
  try { await clearGoogle(); res.status(200).json({ ok: true }); }
  catch (e) { res.status(200).json({ ok: false, error: e.message }); }
}

export default async function handler(req, res) {
  const action = req.query.action;
  if (action === 'auth') return doAuth(req, res);
  if (action === 'status') return doStatus(req, res);
  if (action === 'disconnect') return doDisconnect(req, res);
  res.status(400).json({ error: 'unknown action — expected ?action=auth|status|disconnect' });
}
