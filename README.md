# Triple J Mortgage — ProyTech Business Suite

Jesse Johnson Jr's CRM. Vite + React + Supabase, with Claude-powered AI tools
and a Google Calendar/Gmail integration. See **TRIPLEJ-SETUP.md** for the full
go-live steps (Supabase, Vercel, env vars, Google Cloud, logo).

## Run locally
npm install
npm run dev

You'll need a `.env.local` with at least `VITE_SUPABASE_URL` and
`VITE_SUPABASE_KEY` for the app to connect to a real database locally —
see TRIPLEJ-SETUP.md section 3 for the full variable list.

## Deploy
Push to GitHub, import the repo in Vercel (framework auto-detected as Vite).
All configuration — brand, Supabase project, AI key, Google OAuth — is done
through environment variables (TRIPLEJ-SETUP.md section 3), not committed
into the code, so this same codebase can be redeployed for another client
by swapping env vars alone.

## Logins
Real Supabase Auth logins (email + password), created under
**Authentication → Users** in the Supabase dashboard — or leave
`VITE_DEMO_OPEN=true` set for an open, no-login review link.
