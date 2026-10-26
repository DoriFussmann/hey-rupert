# Investor outreach copy (Phase 5, part 1)

Email copy by fund type for four-tier lists. The full plan (Core personalization, reserve contacts, warm intros, Go Live, reply triage) is in the project doc `claude/rupert-outreach-spec.md`.

| What | Where |
|---|---|
| Groups, styles, checks, rendering (pure) | `copy.ts` |
| Saved styles | `settings-server.ts`, table `outreach_settings` |
| Generator (one Claude call per fund type) | `draftTypedEmailCopy` in `lib/agents-server.ts`, prompt `email_copy_typed` |
| Styles editor | Emails → Investor email styles (`/admin/forms/outreach-styles`) |
| Admin editing | Client → Setup → Email Copy (`typed-copy-editor.tsx`) |
| Client review | `/portal/setup/email-copy` (`typed-copy-review.tsx`) |

**Setup:** run `supabase/outreach_settings.sql` once in the Supabase SQL editor. It creates the table and seeds the new prompt. Until then the default styles apply, and drafting fails with a clear "prompt missing" error.

## How it works

- **Which funds.** The confirmed list's rows, minus client exclusions, hidden duplicates and funds the client marked "I know them" (`outreachRows`). Known funds will get an admin override in a later part.
- **Groups.** Core (tier 1) and the rest (Sphere, Tier 3, Tier 4; approved generalists count as Tier 4), each split by fund type: VC, Family office, Angel group, PE, Other. A type with fewer than 3 funds in a section is written as part of Other.
- **Core.** Per fund type: an approach (the client sees it) and a 3-email template with `{{quick_fact}}`, the slot the per-contact Core emails fill later.
- **Others.** Per fund type: one 3-email sequence with `{{tier_line}}`, plus one sentence per tier.
- **Styles.** Presets with rules, a word cap, proof points, a call to action and an example email. Chosen per section × fund type, with a section default. The default preset, Direct, is the short, plain pattern: who I am, I'll be brief, three facts, one question.
- **Checks.** Errors block the push: missing subject or body, unknown fields, `[placeholders]`, exclamation marks, hype words, "Re:"/"Fwd:" subjects, missing tier lines. Words over the cap are a warning.
- **Opt-out line.** Set with the styles. It goes under the first email only; follow-ups stay in the same thread.
- **Redraft one group.** Only that group is rewritten; every other group, and unsaved edits, stay as they are. This is how Rupert supervises client change requests.
- **Storage.** The `email_copy` setup step, with `copy_version: 2` and `typed`. Older copy (one sequence per tier) and three-tier lists work exactly as before.

# Core contacts (Phase 5, part 2)

Each Core fund gets 2 active contacts with their own emails, written from the Core template of the fund's type and a few sourced Quick Facts. Rupert approves each one.

| What | Where |
|---|---|
| Contact selection, Quick Facts, checks, approval lock (pure) | `core.ts` |
| Sync, research, writing, edits, approvals | `core-server.ts`, tables `fund_research` and `outreach_messages` |
| Prompts | `core_quick_facts` (web search, up to 4 searches) and `core_email` |
| Admin | Client → Setup → Core contacts (`core-contacts-panel.tsx`) |
| Client | Email Copy → Core: "See all personal Core emails" (approved only) |

**Setup:** run `supabase/outreach_core.sql` once. It creates both tables and seeds both prompts.

## How it works

- **Line up contacts.** Reads the confirmed list's Core funds and their saved run.
  - Active contacts: the engine's Primary and Backup. A contact verification flagged (bad email, left firm, role changed, not found) or that Rupert removed is skipped, and the next best takes its place.
  - Everyone else with an email is a reserve.
  - Running it again adds new contacts and removes funds that left Core. It never touches contacts already there.
- **Write.** Per contact: Quick Facts research, then the three emails. Every fact needs a source link, or it's dropped.
  - Fund facts are cached for 60 days and shared across clients. A fund's second contact reuses them, and that fund's contacts are written one after another.
  - A fund that backed one of the company's competitors is flagged.
- **Review.** Rupert edits, approves, or rewrites one contact (keeping or refreshing its research), with an optional note for the rewrite.
  - Approval is blocked while a check fails. No `{{fields}}` may remain.
  - Editing approved text clears the approval: an approval is tied to the exact text (hash).
- **Rewrite all of a fund type.** After the Core template changes, for example after a client asks for changes, this rewrites every active contact of that type and keeps their Quick Facts.
- **Reserves.** Shown as "N more available" per fund. Activate puts one in the campaign, unwritten. Move to reserve takes one out.
- **The client** sees only approved, active contacts' emails and their Quick Facts, in an optional list under Core.

# Campaign and warm intros (Phase 5, part 3)

| What | Where |
|---|---|
| Rendering the other tiers, readiness, export (pure) | `campaign.ts` |
| Build, staleness, export, known funds, blurb | `campaign-server.ts`, `known-server.ts`, tables `outreach_campaigns` and `outreach_known_funds` |
| Admin | Client → Setup → Campaign (`campaign-panel.tsx`); CSV at `/admin/clients/[id]/campaign/export?wave=1\|2\|all` |
| Client | `/portal/setup/warm-intros`, linked from the confirmed investor list |
| Prompt | `warm_intro_blurb` |

**Setup:** run `supabase/outreach_campaign.sql` once.

## Build

- **When it can run:** the client has confirmed the copy (copy by fund type) and every active Core contact is approved. Otherwise the panel lists what's missing.
- **What it does:** Core rows keep Rupert's approved emails. Every Sphere, Tier 3 and Tier 4 fund gets its 2 contacts (same picking as Core), with its type's sequence filled in.
  - The tier line, first name and fund name are filled in; a missing first name gives "Hi,".
  - These rows are approved by the client's confirmation, recorded as `client confirmation (copy vN)`.
  - A fund whose type has no copy group is listed as not written.
- **Stale:** a newer confirmed copy version, or a different list run, makes the build stale. Export is refused until it's built again.

## Export (Instantly CSV)

- **Which rows:** only active contacts whose text matches its approval hash. Edited text is skipped until it's approved again.
- **Columns:** email, names, fund, tier, type, wave, then `subject_N`, `body_N` (text) and `body_N_html` for N = 1–3.
- **Opt-out line:** on body 1 only.
- **Waves:** wave 1 is each fund's first contact; wave 2 is the rest, sent a few days later.
- **Untested:** whether Instantly takes a whole body as one variable, and whether a blank subject variable keeps a follow-up in the thread. Send a test first.

## Warm intros

- **What the client sees:** funds marked "I know them" are out of automation. The page lists who to ask about at each fund (names and titles only), and a note to forward (ask + blurb, `{{fund_name}}` filled per fund). They set a progress status and a note.
- **What Rupert sees:** every known fund with the client's progress. **Put back in the campaign** includes a fund again, and the client sees that he did. Redraft or rebuild afterwards so it's included.

# Go Live, Instantly and replies (Phase 5, part 5)

| What | Where |
|---|---|
| Campaign payload, leads, gates, events, labels, client pipeline (pure) | `live.ts` |
| Instantly API calls | `lib/instantly.ts` |
| Inbox, invoice, Go Live, test send, waves, pause | `live-server.ts` |
| Webhook intake, triage decisions, client data | `replies-server.ts` (AI labelling in `reply-label-server.ts`) |
| Routes | `/api/instantly/webhook`, `/api/cron/outreach` (daily, wave 2) |
| Admin | Setup → Go Live panel; Clients → Replies (`/admin/replies`) |
| Client | `/portal/setup/go-live`; Investor Inbox, Engagement Tracker, Campaign Analytics on real data |

**Setup:**
- Run `supabase/outreach_live.sql`.
- Set `INSTANTLY_API_KEY` (scopes: accounts, campaigns, leads, webhooks) and `INSTANTLY_WEBHOOK_SECRET` (any long random string) in Vercel.
- `CRON_SECRET` is already used by the other crons.

## Flow

1. **The inbox.** The client signs in with Google or Microsoft through Instantly's OAuth: a popup, polled until connected. No password reaches the portal.
   - Warmup is switched on, and the account status is checked; only Instantly status 1 counts as healthy.
   - If the inbox is already in the workspace, Rupert links it by email.
2. **The invoice.** Rupert pastes the first monthly invoice link (Service Order 3.4). The Stripe webhook matches it by link before the Setup Fee flow; Rupert can also mark it paid.
3. **Go Live.** The client ticks the authorization and clicks Go Live. Enabled only when the campaign is built and fully approved, the inbox is healthy and the invoice is paid.
   - Go Live creates the Instantly campaign: three steps whose subject and body are per-lead variables; follow-ups go in the same thread; weekdays; stop on reply and stop for company.
   - It registers a webhook for that campaign with the secret header, adds wave 1, activates the campaign, records the consent and sets the client to Live.
   - Each step saves its progress, so a retry continues where it stopped.
4. **Wave 2.** Each fund's second contact starts N days later (daily cron), or when Rupert clicks Start wave 2 now.
   - **Add newly approved contacts** pushes reserves activated after launch.
   - Pause and Resume map to Instantly.
5. **Send test to me.** Before Go Live, a separate test campaign sends one approved contact's three emails to Rupert from the client's inbox, two minutes apart. Use it to confirm formatting and threading.
6. **Frozen after launch.** Rebuilding the campaign, re-syncing Core contacts and editing pushed contacts are refused.

## Replies

- **Intake.** Every webhook event is logged in `outreach_events` and updates the contact: sent, opened, replied, bounced, unsubscribed, meeting. Replies and auto-replies go into `outreach_replies` as **pending**, deduplicated by Instantly's email id. Rupert gets an email for each real reply.
- **Triage** (`/admin/replies`). Claude labels new replies (prompt `reply_triage`) with a one-line summary and a suggestion. Rupert releases, withholds (with a private reason) or undoes. Bounced contacts are listed with a pointer to the reserves.
- **The client** sees released replies only: Investor Inbox, Engagement Tracker (furthest stage per fund) and Campaign Analytics. They reply from their own email, in the thread; there is no reply box in the portal.
