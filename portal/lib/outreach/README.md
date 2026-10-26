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
