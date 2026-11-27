# STATUS — hey-rupert

Maintained by Claude at the end of every working session. Framework: "Operating Framework" doc in the Night Ventures Claude project.
Last updated: 2026-11-27 (initial version, from a read-only scan — builds not yet run).

## What this is
- **`site/`**: public marketing site for Rupert (heyrupert.com), an expert-managed investor-outreach service for founders. It is not SaaS and not a CRM. Positioning is in `New Build Site.md`, brand in `Design Guide.md`, all copy in `site_copy.md`.
- **`portal/`**: client and admin portal at `/login`, `/admin`, `/portal`, `/auth`. It covers client setup, SOW/NDA signing, investor matching, outreach via Instantly, and Stripe/Resend/Cal webhooks.
- Articles are mostly generated and published by **The Night Ventures (TNV)**. TNV commits to `site/src/content/articles/` and `site/src/assets/articles/`. New articles merge straight to `main`, and edits arrive as PRs.

## Stack
- npm workspaces: `site`, `portal`.
- `site`: Astro 5, Tailwind 4, content collections in `src/content.config.ts` (`articles` with ~45 files, `services`, `team`). Site config is in `src/config/site.ts`.
- `portal`: Next 14 App Router, Tailwind 3, Supabase via `@supabase/ssr`. Clients are in `portal/lib/supabase/{client,server,admin}.ts`, auth and role gating in `portal/middleware.ts`.
- Shared: `seo-core` pinned as `github:DoriFussmann/seo-core#v1.9.0`. It is used in `astro.config.mjs` (sitemap, rehype/remark), `scripts/audit-dist.ts` and `site/middleware.js`.
- Hosting: Vercel, as two projects. The site's production environment is `Production – hey-rupert-site`, and the portal is at `hey-rupert-portal.vercel.app`.

## How to build / check
| Where | Command | Notes |
|---|---|---|
| site | `npm run build -w site` | `astro build` plus the seo-core dist audit. This is the only check the site has. |
| portal | `npm run build -w portal` | `next build`, which also type-checks |
| portal | `npm run lint -w portal` | next lint |
| portal | `npm test -w portal` | node:test over globs listed by hand in `package.json`. **A new test directory must be added to the script.** |
There are no site lint, typecheck or test scripts, and no CI build workflow.

## Deploy
- Merging to `main` deploys to production on Vercel.
- `site/vercel.json` has ~60 permanent redirects (old slugs, `/blog`, `/team`). It also has rewrites that proxy `/admin`, `/portal`, `/auth`, `/api`, `/_next` and `/login` to the portal host, which is hardcoded.
- `portal/vercel.json` has 8 crons (reminders, site-check, outreach, daily-summary, prospects, holidays, presend twice a day), authenticated with `CRON_SECRET`.
- `.github/workflows/indexnow.yml` submits changed URLs to IndexNow after each successful site production deploy, or by hand.

## Data
- Supabase schema lives as about 80 **flat `.sql` files in `portal/supabase/`**. They have no numbering and no runner, and appear to be applied by hand. This is an exception to the framework's numbered-migrations rule. New schema changes go in as new files there and are applied via Supabase.
- `client_password_setups.sql` at the root duplicates `portal/supabase/client_password_setups.sql`.
- **Env var names** (values only in Vercel):
  - **portal:**
    - Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
    - URLs: `NEXT_PUBLIC_PORTAL_URL`, `NEXT_PUBLIC_LAUNCH_CALL_URL`
    - Email: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_FROM`, `EMAIL_FROM_TRACKED`, `ADMIN_NOTIFY_EMAIL`, `ADMIN_TIME_ZONE`
    - Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
    - AI and data: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `HUNTER_API_KEY`
    - Outreach and scheduling: `INSTANTLY_API_KEY`, `INSTANTLY_WEBHOOK_SECRET`, `CRON_SECRET`, `CAL_WEBHOOK_SECRET`
    - `CAL_WEBHOOK_SECRET` and `ADMIN_TIME_ZONE` are missing from `.env.example`.
  - **site:** `PUBLIC_BOOKING_ENDPOINT`, `PUBLIC_CAL_COM_URL`, `PUBLIC_ANALYTICS_ID`, `PUBLIC_SEARCH_CONSOLE_VERIFICATION`, `TNV_BOT_TOKEN` (AI-crawler tracking; inert if unset).

## Sensitive areas (need CEO yes per framework)
- Portal auth and roles (`middleware.ts`, `lib/public-paths`), Stripe, outreach sends (Instantly, Resend), and anything that emails real people.

## Known quirks
- Redirects and rewrites are duplicated with and without a trailing slash. Keep both when adding new ones.
- `site/src/pages/index.astro` is ~550 lines and is the main home-page edit target.
- Large PNGs are duplicated in `Images/` and `site/src/assets/`.
- Installs need GitHub access, because `seo-core` is a git dependency.

## Current state
- HEAD at setup: `da6e36b` "Fixes from the Dayroom run (#191)".
- Builds and tests have not yet been verified by Claude. The first session should establish a known-good baseline.

## Open work
- (none recorded yet)
