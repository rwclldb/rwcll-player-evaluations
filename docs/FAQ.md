# RWCLL Player Evaluations — FAQ & How-To

## Project overview
- Stack: Next.js, Supabase (PostgreSQL and Auth), npm
- Local development: Windows, PowerShell, VS Code
- Local folder: `D:\sandbox\RWCLL\rwcll-player-evaluations`
- Private GitHub repository: `rwcll-player-evaluations`

## Verified setup (2026-11-02)
- [x] Next.js + Supabase starter created.
- [x] App loads at `http://localhost:3000`.
- [x] `.env.local` is Git-ignored (`git check-ignore -v .env.local` confirmed `.gitignore:34:.env*.local`).
- [x] Initial scaffold committed as `34f85d2` and pushed to `main`.
- [x] Supabase test user created; sign-in succeeded and protected page displayed user claims.
- [ ] RWCLL database tables and RLS policies created and tested.

Successful sign-in verifies Supabase Auth, not the RWCLL database schema, queries, or authorization policies.

## Start the app
From the project root in VS Code:
```powershell
npm run dev
```
Open `http://localhost:3000`. Stop with `Ctrl+C`.

## Git basics
```powershell
git status
git add .
git status
git commit -m "Describe the change"
git push
```
Review staged files before committing. Test locally first. Never commit secrets. Roadmap items are checked only after implementation and testing.

## Environment variables and secrets
`.env.local` contains the Supabase project URL and publishable key. Keep it local and untracked.
```powershell
git check-ignore -v .env.local
```
Variable names: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
`.env.example` may be committed only with placeholders. Never share `.env.local`, passwords, tokens, service-role keys, or database credentials. Never expose a service-role/secret key to browser code. Restart the dev server after changing environment variables.

## Supabase dashboard
- **Authentication → Users:** manage test accounts.
- **SQL Editor:** apply reviewed schema SQL/migrations.
- **Table Editor:** inspect development data.
- **Project Settings → API:** view project URL and publishable key.

Prefer version-controlled SQL migrations as the schema develops. Do not load live league data before RLS policies are implemented and tested.

## Product rules to preserve
- Coach and independent-evaluator averages remain separate.
- Coaches see group averages, not individual coach ratings.
- Independent evaluator identities are hidden from coaches.
- Administrators can inspect individual submissions.
- Not Evaluated is not zero and is excluded from averages.
- Five required core ratings: Hitting, Throwing, Grounders, Fly balls, Running / Awareness.
- Pitching/catching categories are optional for AAA and above.
- Historical ratings are read-only and excluded from current averages.
- Private coach notes must not leak through shared notes or score queries.

## Authentication and roles
The starter includes sign-up UI. The intended RWCLL app uses administrator-managed invitations, not public registration. A Supabase-authenticated user is not automatically an RWCLL administrator; application roles and permissions must be implemented separately. Enforce access with database RLS, not just frontend visibility.

## Troubleshooting
**App will not start:** confirm the terminal is in the folder containing `package.json`, run `npm run dev`, and inspect the first terminal error.

**Environment warning:** confirm `.env.local` is in the project root and variable names match `.env.example`. Do not share values. Restart the dev server after edits.

**Sign-in fails:** confirm the user exists in Supabase Authentication and check email confirmation status. Remove tokens and personal information before sharing error text.

## Documentation upkeep
Update the FAQ with verified procedures, the roadmap with implementation-and-test status, and the decision log with durable decisions. After substantive project updates, update all three where relevant.
