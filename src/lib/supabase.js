import { createClient } from '@supabase/supabase-js';
import { BRAND, SUPABASE_URL, SUPABASE_KEY, SUPABASE_OK } from './brand';

/* Per-tenant Supabase, from Vercel env vars (see src/lib/brand.js).
   The publishable key is safe in client code — real protection is Row Level
   Security + logins. NEVER put the secret/service key here.
   If the env vars are missing we create a dud client so the app can render a
   clear setup screen instead of silently pointing at the wrong database. */
export const supabase = createClient(
  SUPABASE_OK ? SUPABASE_URL : 'https://missing.supabase.co',
  SUPABASE_OK ? SUPABASE_KEY : 'missing'
);
export const configured = SUPABASE_OK;

/* ---- auth ----
   Two-partner installs signed in with a username that we mapped to
   username@<authDomain>. A lending TEAM signs in with a real work email.
   So: if the entered value already contains "@", use it verbatim; otherwise
   fall back to the legacy username→username@<authDomain> mapping. This keeps
   every existing single-tenant login working unchanged. */
const emailFor = u => { const s=(u||'').trim().toLowerCase(); return s ? (s.includes('@') ? s : `${s}@${BRAND.authDomain}`) : s; };
const randomPw = () => { try{ const a=new Uint8Array(18); (globalThis.crypto||window.crypto).getRandomValues(a); return 'Aa1!'+Array.from(a,b=>b.toString(36)).join(''); }catch{ return 'Aa1!'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2); } };
export const auth = {
  login(username, password) { return supabase.auth.signInWithPassword({ email: emailFor(username), password }); },
  /* open-demo mode: a real but anonymous session (has an auth uid, so RLS still
     works) — used when VITE_DEMO_OPEN=true to skip the login screen entirely.
     Requires "Allow anonymous sign-ins" enabled in Supabase Auth settings. */
  loginAnon() { return supabase.auth.signInAnonymously(); },
  logout() { return supabase.auth.signOut(); },
  async session() { const { data } = await supabase.auth.getSession(); return data.session; },
  onChange(cb) { return supabase.auth.onAuthStateChange((_e, s) => cb(s)); },
  username(session) { return (session?.user?.email || '').split('@')[0]; },
  uid(session) { return session?.user?.id || null; },
  email(session) { return session?.user?.email || ''; },
  /* let a signed-in user set/reset their own password (used by password reset flow) */
  sendReset(email) { return supabase.auth.resetPasswordForEmail((email||'').trim().toLowerCase()); },
};

/* ---- data: leads as JSON rows + one shared settings row ----
   Multi-user builds also mirror owner_id + pool into real columns beside the
   jsonb `data`, because Row Level Security can only enforce on real columns.
   Every read/write is written to tolerate a database where those columns don't
   exist yet (MIGRATION.sql not run) — it silently falls back to id,data so a
   pre-migration single-tenant install keeps working exactly as before. */
const SENTINEL = '00000000-0000-0000-0000-000000000000';
const leadRow = lead => ({ id: lead.id, owner_id: lead.owner_id || null, pool: lead.pool || null, data: { ...lead, id: lead.id } });
const fromRow = r => { const base = { ...r.data, id: r.id };
  if ('owner_id' in r && r.owner_id != null) base.owner_id = r.owner_id;
  if ('pool' in r && r.pool != null) base.pool = r.pool;
  return base; };
export const db = {
  async getLeads() {
    let res = await supabase.from('leads').select('id,data,owner_id,pool');
    if (res.error) { res = await supabase.from('leads').select('id,data'); if (res.error) throw res.error; }
    return (res.data || []).map(fromRow);
  },
  async upsertLead(lead) {
    let { error } = await supabase.from('leads').upsert(leadRow(lead));
    if (error) { ({ error } = await supabase.from('leads').upsert({ id: lead.id, data: { ...lead, id: lead.id } })); }
    if (error) throw error;
  },
  async upsertMany(leads) {
    if (!leads.length) return;
    let { error } = await supabase.from('leads').upsert(leads.map(leadRow));
    if (error) { ({ error } = await supabase.from('leads').upsert(leads.map(l => ({ id: l.id, data: { ...l, id: l.id } })))); }
    if (error) throw error;
  },
  async deleteLead(id) {
    const { error } = await supabase.from('leads').delete().eq('id', id);
    if (error) throw error;
  },
  async deleteAll() {
    const { error } = await supabase.from('leads').delete().neq('id', SENTINEL);
    if (error) throw error;
  },
  /* ---- crm_users: one row per person (auth uid, name, role, pools) ----
     Returns [] on any error (table missing / RLS) so an install that never ran
     MIGRATION.sql behaves as a single-tenant CRM. An officer's own RLS policy
     lets them read only their own row; a manager reads everyone. */
  async getUsers() {
    const { data, error } = await supabase.from('crm_users').select('id,name,role,pools');
    if (error) throw error;
    return (data || []).map(u => ({ ...u, pools: Array.isArray(u.pools) ? u.pools : [] }));
  },
  async upsertUser(u) {
    const { error } = await supabase.from('crm_users').upsert({ id: u.id, name: u.name, role: u.role || 'officer', pools: u.pools || [] });
    if (error) throw error;
  },
  async removeUser(id) {
    const { error } = await supabase.from('crm_users').delete().eq('id', id);
    if (error) throw error;
  },
  /* Create the Supabase Auth user for a new teammate by email, WITHOUT touching
     the current session. We hit the gotrue /signup endpoint with raw fetch (the
     client library only stores a session when you call its own methods), so the
     manager stays signed in. Returns the new user's uid. If the email already
     exists gotrue still returns 200 (anti-enumeration) — the password-reset
     email that follows is what lets them in either way. */
  async inviteUser(email) {
    const em = (email || '').trim().toLowerCase();
    if (!em) throw new Error('Enter an email.');
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ email: em, password: randomPw() }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.msg || j.error_description || j.error || 'Could not create that user. Check that email signups are enabled in Supabase → Authentication → Providers.');
    const id = j.id || (j.user && j.user.id) || null;
    return { id, email: em };
  },
  async getSettings() {
    const { data, error } = await supabase.from('app_settings').select('data').eq('id', 'main').maybeSingle();
    if (error) throw error;
    return data?.data || null;
  },
  async saveSettings(obj) {
    const { error } = await supabase.from('app_settings').upsert({ id: 'main', data: obj });
    if (error) throw error;
  },
  async getInvoices() {
    const { data, error } = await supabase.from('app_settings').select('data').eq('id', 'invoices').maybeSingle();
    if (error) throw error;
    return (data?.data?.list) || [];
  },
  async saveInvoices(list) {
    const { error } = await supabase.from('app_settings').upsert({ id: 'invoices', data: { list } });
    if (error) throw error;
  },
  async getTxns() {
    const { data, error } = await supabase.from('app_settings').select('data').eq('id', 'txns').maybeSingle();
    if (error) throw error;
    return (data?.data?.list) || [];
  },
  async saveTxns(list) {
    const { error } = await supabase.from('app_settings').upsert({ id: 'txns', data: { list } });
    if (error) throw error;
  },
  async getTasks() {
    const { data, error } = await supabase.from('app_settings').select('data').eq('id', 'tasks').maybeSingle();
    if (error) throw error;
    return (data?.data?.list) || [];
  },
  async saveTasks(list) {
    const { error } = await supabase.from('app_settings').upsert({ id: 'tasks', data: { list } });
    if (error) throw error;
  },
  /* ---- receipt files live in Supabase Storage (bucket 'receipts'), NOT in the DB ---- */
  async uploadReceipt(path, file) {
    const { error } = await supabase.storage.from('receipts').upload(path, file, { contentType: file.type || 'application/pdf', upsert: true });
    if (error) throw error;
    return path;
  },
  async downloadReceipt(path) {
    const { data, error } = await supabase.storage.from('receipts').download(path);
    if (error) throw error;
    return data; // Blob
  },
  async removeReceipt(path) {
    const { error } = await supabase.storage.from('receipts').remove([path]);
    if (error) throw error;
  },
  async receiptUrl(path) {
    const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 3600);
    if (error) throw error;
    return data?.signedUrl || null;
  },
};
