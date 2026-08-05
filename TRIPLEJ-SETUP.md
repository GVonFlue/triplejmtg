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
| `GOOGLE_CLIENT_ID` | from step 4 — **Jesse's own**, not ProyTech's |
| `GOOGLE_CLIENT_SECRET` | from step 4 — **Jesse's own**, not ProyTech's |
| `GOOGLE_REDIRECT_URI` | `https://triplejmtg.vercel.app/api/google-callback` |
| `APP_URL` | `https://triplejmtg.vercel.app` |
| `RESEND_API_KEY` | optional — enables the Terms of Service signed-notice email (§8). Omit and the app still works; the signature is just saved to the database without emailing anyone. |
| `TOS_NOTIFY_EMAIL` | optional — who gets that email. Defaults to `admin@getproytech.com` if unset. |

## 4. Google Cloud (Gmail drafts + Calendar) — for #8 and #9

**This is Jesse's Google account, not ProyTech's.** The OAuth app just needs to exist
somewhere; there's no reason it lives under getproytech.com, and doing it this way means
ProyTech is never "attached" to a client's Google account or data — Jesse authorizes his
own calendar/Gmail, the refresh token sits server-side in his own Supabase project, and
ProyTech never touches it. Have Jesse do steps 1–4 himself (or screen-share it), then he
hands you just the Client ID and Client secret to paste into Vercel.

1. console.cloud.google.com, signed in as **Jesse's own Google account** → new project,
   e.g. "Triple J Mortgage CRM".
2. **APIs & Services → Enable APIs** → enable **Google Calendar API** and **Gmail API**.
3. **OAuth consent screen** → External → add Jesse's own Google account as a **Test user**
   (test mode is fine — it's just him; no Google verification needed, since sensitive-scope
   verification is only required to publish to the general public).
4. **Credentials → Create OAuth client ID → Web application:**
   - Authorized redirect URI: `https://triplejmtg.vercel.app/api/google-callback`
   - Copy the **Client ID** and **Client secret** — Jesse sends you these two values,
     nothing else — paste them into the Vercel env vars above.
5. After deploy, Jesse clicks **Settings → Connect Google Calendar**, signs in with his
   own Google account, approves once, and both Calendar (meetings auto-post) and Gmail
   (AI drafts land in his Drafts) are live. The scopes requested are `calendar.events` and
   `gmail.compose` (drafts only — the app can never send mail on its own).

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
- **Gmail drafts + Calendar** — activate after step 4 and Jesse connects his own Google account.
- **Terms of Service gate** — a new sign-in blocks entering any data until it's agreed to
  and signed. See §8.

## 7. Notes

- **Commission that changes mid-year:** the Settings rate is the *default*. On any single
  loan, set its own `Commission %` / flat `$` on the loan record and that loan uses it.
  The dashboard commission math reads each loan's own rate.
- **Numbers integrity:** `verify-kpi.mjs` is a harness that reads the real stage list and
  asserts the Pipeline Status groups always equal the KPI tiles. Run `node verify-kpi.mjs`
  after any change to stages or metrics.
- **Adding a seat:** Settings → Your Plan & Seats → "Request a seat ($25/mo)" opens a
  pre-filled email to gvonflue@gmail.com. (Build is single-seat by design — no self-serve
  Team screen is shown, since Jesse is the only officer on this install.)
- **Changing his own password:** Jesse doesn't need the password you set when creating his
  account. Settings → **Your password** lets him set a new one any time — no "current
  password" required, since being signed in already proves it's him.
- **Meeting types are lender-specific and editable:** Settings → Dropdown Options →
  "Meeting Type" (Intro Call, Application, Pre-Approval Review, Rate Lock, Closing
  Walkthrough, Check-in, Other, by default) — add, remove, or rename any of them there.
- **Vercel's Hobby plan caps a deployment at 12 Serverless Functions.** This project sits
  at 11 (`api/*.js`, minus `_google.js` which isn't a route). If you add another server-side
  feature and hit the cap again, the fix is almost always to fold a small new endpoint into
  an existing file with an `?action=` branch (see `api/google.js` for the pattern) rather
  than paying for the Pro plan — a new file per tiny endpoint adds up fast. This limit is
  per Vercel *project*, not shared account-wide, so every other client site you build
  still gets its own fresh 12-function budget on the free Hobby plan.

## 8. Terms of Service gate

On first sign-in (and again for any new signer), the app shows the Terms of Service full
-screen and won't let anyone into the CRM until they type their name, check "I agree," and
click Sign. That signature is saved permanently in Supabase (`app_settings`, row id
`'tos'`) — it survives redeploys and can never be silently reset. If `RESEND_API_KEY` is
set (see §3), a copy is also emailed to `TOS_NOTIFY_EMAIL` (default
`admin@getproytech.com`) the moment someone signs; without that key the app still works
exactly the same, it just doesn't send the email.

**The Terms of Service text itself is a draft I wrote, not reviewed by an attorney.** It's
in `src/App.jsx` as the `TOS_TEXT` constant — read it, and have it reviewed by a lawyer
before treating a signature on it as a binding agreement. Send me updated wording any time
and I'll swap it in.

To set up the email (optional):
1. Create a free account at resend.com — no credit card required for the free tier
   (100 emails/day, 3,000/month).
2. Either use their shared `onboarding@resend.dev` sender as-is (fine for low-volume
   notifications like this), or verify your own sending domain under **Domains** if you
   want it to come from a getproytech.com address (then set `TOS_NOTIFY_FROM` to match,
   e.g. `ProyTech <notices@getproytech.com>`).
3. **API Keys → Create API Key** → copy it into Vercel as `RESEND_API_KEY` → Redeploy.
