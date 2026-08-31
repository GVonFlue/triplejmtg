// Shared Google helpers for the calendar integration.
// Underscore prefix => Vercel does NOT expose this as a route.
//
// Required env vars (Vercel → Project → Settings → Environment Variables):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, APP_URL
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (service-role key stays server-only)
//
// The refresh token lives in a `secrets` table that Row Level Security blocks
// from the browser; only the service-role key (here on the server) can read it.
import { createClient } from '@supabase/supabase-js';
import { supaUrl, supaKey } from '@proytech/core/env';

export const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.compose', // create drafts in the user's Gmail
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
].join(' ');

export const appUrl = () => process.env.APP_URL || 'https://proytech-crm.vercel.app';
export const redirectUri = () => process.env.GOOGLE_REDIRECT_URI || (appUrl() + '/api/google-callback');

function store() {
  /* THIS FILE WAS THE BUG THE SHARED env MODULE WAS WRITTEN ABOUT.
     It read SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and accepted neither
     VITE_SUPABASE_URL nor the shorter SUPABASE_SERVICE_KEY spelling — while
     every other server file accepted both. An install that followed its own
     docs got a working assistant, a working rate limiter, and a Google
     integration that silently could not read its own token. Nothing errored.

     One import closes it, and keeps it closed: there is now exactly one place
     that knows how to find Supabase from the server. */
  const url = supaUrl();
  const key = supaKey();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function saveGoogle(obj) {
  const s = store();
  if (!s) throw new Error('Supabase service role not configured');
  const { error } = await s.from('secrets').upsert({ id: 'google', data: obj });
  if (error) throw error;
}
export async function loadGoogle() {
  const s = store();
  if (!s) return null;
  const { data, error } = await s.from('secrets').select('data').eq('id', 'google').maybeSingle();
  if (error) throw error;
  return data?.data || null;
}
export async function clearGoogle() {
  const s = store();
  if (!s) return;
  await s.from('secrets').delete().eq('id', 'google');
}

// Exchange the stored refresh token for a fresh, short-lived access token.
export async function getAccessToken() {
  const g = await loadGoogle();
  if (!g?.refresh_token) return null;
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    refresh_token: g.refresh_token,
    grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || 'token refresh failed');
  return j.access_token;
}
