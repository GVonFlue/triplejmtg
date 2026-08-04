# Triple J Mortgage — ProyTech Business Suite: Go-Live Guide

Everything Jesse's build needs to go live at **triplejmtg.vercel.app**. Do these in order.
The core CRM works the moment it's deployed with Supabase; the AI tools and Gmail/Calendar
switch on as you add the keys in steps 4–5.

---

## 1. Supabase (the database)

You can use a fresh project (cleanest for a paying client) or an existing one.

1. Create/open the project → **SQL Editor** → run **`SETUP.sql`** from this repo. That
   creates the `leads`, `app_settings`, `crm_users`, and `secrets` tables with row-level
   security. (`secrets` holds the Google token, server-side only.)
2. **Project Settings → API** — copy two values:
   - **Project URL** → this is `VITE_SUPABASE_URL` **and** `SUPABASE_URL`
   - **`anon` / publishable key** → `VITE_SUPABASE_KEY`
   - **`service_role` key** (keep secret) → `SUPABASE_SERVICE_ROLE_KEY`
3. **Authentication → Providers** — enable Email, and (for a no-login review) toggle
   **Allow anonymous sign-ins** on if you want `VITE_DEMO_OPEN=true`. For Jesse's real
   login, create his user under **Authentication → Users**.

## 2. Vercel (hosting)

1. Import the GitHub repo into Vercel as a new project. Framework: **Vite**. Build command
   `npm run build`, output `dist`.
2. Set the domain to **triplejmtg.vercel.app** (Project → Settings → Domains).
3. Add the environment variables in step 3, then **Deploy**. Redeploy any time you change env.

## 3. Environment variables (Vercel → Settings → Environment Variables)

**Brand + database (build-time, must start with `VITE_`):**

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | your Supabase Project URL |
| `VITE_SUPABASE_KEY` | Supabase anon/publishable key |
| `VITE_BRAND_NAME` | `ProyTech` |
| `VITE_APP_TITLE` | `ProyTech Business Suite` |
| `VITE_BRAND_SHORT` | `Triple J Mortgage` |
| `VITE_TEAM` | `Jesse Johnson Jr` (first name is the default loan officer + email signature) |
| `VITE_DEMO_OPEN` | `true` for an open review link, remove for real logins |

**Server-side (AI + Google — no `VITE_` prefix, never reach the browser):**

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | **ProyTech's** Anthropic key — powers every AI feature |
| `SUPABASE_URL` | same Project URL as above |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key |
| `GOOGLE_CLIENT_ID` | from step 4 |
| `GOOGLE_CLIENT_SECRET` | from step 4 |
| `GOOGLE_REDIRECT_URI` | `https://triplejmtg.vercel.app/api/google-callback` |
| `APP_URL` | `https://triplejmtg.vercel.app` |

## 4. Google Cloud (Gmail drafts + Calendar) — for #8 and #9

1. console.cloud.google.com → new project "Triple J Mortgage".
2. **APIs & Services → Enable APIs** → enable **Google Calendar API** and **Gmail API**.
3. **OAuth consent screen** → External → add Jesse's Google account as a **Test user**
   (test mode is fine for one user; no Google verification needed).
4. **Credentials → Create OAuth client ID → Web application:**
   - Authorized redirect URI: `https://triplejmtg.vercel.app/api/google-callback`
   - Copy the **Client ID** and **Client secret** into the Vercel env vars above.
5. After deploy, Jesse clicks **Settings → Connect Google Calendar**, approves once, and
   both Calendar (meetings auto-post) and Gmail (AI drafts land in his Drafts) are live.
   The scopes requested are `calendar.events` and `gmail.compose` (drafts only — the app
   can never send mail on its own).

## 5. The logo

Generate the logo and save it as **`public/triplejmortgagelogo.png`**. The sidebar shows
the "ProyTech Business Suite" label with his logo directly beneath it. Until the file is
there, the sidebar falls back to a text logo — no error.

## 6. What's live, and where it lives

- **Core CRM** (leads, loans, pipeline, dashboard, Pipeline Status widget, Conversations,
  per-loan commission, pre-approval dates + expiry alerts, Follow-Up) — works as soon as
  Supabase is connected.
- **AI Tools tab + dashboard "How do I…?" helper + AI CSV import** — activate with
  `ANTHROPIC_API_KEY`. Model is Claude Haiku (pennies per run).
- **Gmail drafts + Calendar** — activate after step 4 and Jesse connects his Google account.

## 7. Notes

- **Commission that changes mid-year:** the Settings rate is the *default*. On any single
  loan, set its own `Commission %` / flat `$` on the loan record and that loan uses it.
  The dashboard commission math reads each loan's own rate.
- **Numbers integrity:** `verify-kpi.mjs` is a harness that reads the real stage list and
  asserts the Pipeline Status groups always equal the KPI tiles. Run `node verify-kpi.mjs`
  after any change to stages or metrics.
- **Adding a seat:** Settings → Your Plan & Seats → "Request a seat ($25/mo)" opens a
  pre-filled email to gvonflue@gmail.com. (Build is single-seat by design.)
