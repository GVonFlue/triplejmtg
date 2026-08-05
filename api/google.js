// Combines google-auth / google-status / google-disconnect into ONE serverless
// function, branched on ?action=. Vercel's Hobby plan caps a deployment at 12
// Serverless Functions; this project was sitting right at that limit, so three
// tiny always-fast endpoints were merged into one rather than paying for Pro.
// (google-callback.js stays its OWN file on purpose — its exact path
// /api/google-callback is registered as the redirect URI in Google Cloud, so
// changing that path would mean re-configuring the OAuth client too.)
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
  try {
    const g = await loadGoogle();
    res.status(200).json({ connected: !!(g && g.refresh_token), email: (g && g.email) || '' });
  } catch (e) {
    res.status(200).json({ connected: false, email: '', error: e.message });
  }
}

async function doDisconnect(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
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
