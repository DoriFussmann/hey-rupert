# Company profile

Turns a founder's intake into a standard, validated company profile that uses the
investor taxonomy (`lib/taxonomy`). Admin view: **Clients → (client) → Company profile →
Classification**.

## The intake-to-match flow

| Step | Where | What is stored | Authoritative for |
|---|---|---|---|
| 1. Founder interview | `/portal/intake`, `lib/intake-server.ts` | `intake_interviews.messages`, `topic_status`, confirmed `summary` | What the founder said |
| 2. Profile fields | Admin "Analyze" on the client page (or "Rebuild from intake" on the profile page), once the intake is complete, `extractAnswers` in `lib/match/profile-server.ts` | `match_profiles.answers` (+ `settings`) | **What the current matching engine runs on** |
| 3. Canonical profile | Same build, plus the admin actions below; `lib/company-profile` | `company_profile_versions` (append-only) | Sector, stage and geography as taxonomy categories, with evidence |
| 4. Match | `lib/match/run-server.ts` → `buildProfile(answers)` → `to-profile.mjs` → engine | Match views | Unchanged in Phase 2 |

Other inputs and how they relate:
- **Interview topics** (Forms → Intake, `form_templates.intake_topics`, defaults in `lib/intake.ts`) drive the live interview.
- **`lib/match/intake/intake-questions.json`** is not used by the live interview; it only supplies field descriptions to the profile-building AI. Kept as is.
- **Onboarding fields** on `clients` (raise stage, vertical, geography) are given to the AI as "already known". They are not founder evidence.
- **The intake brief** (`intake_interviews.admin_brief`) is a separate summary for the team. Matching does not use it.

## The canonical profile (`core.ts`, schema 1)

- `identity`: name, website, one-liner.
- `business`: the product (what the company itself builds or sells), the business model, and the customers (who pays). Also `notCompanySectors`: industries the founder mentioned that are its customers', suppliers' or channels', not its own.
- `sectors`: one `primary` and up to two `secondary` sector categories.
- `stage`, `hq.country`, `hq.state`, `hq.city`, `markets`, `financing`, `firmTypes` (empty means set from the stage).
- `raise`, `exclusions` (existing investors, funds already pitched, no-go, competitors), `ambiguities` (questions to ask the founder), `converterWarnings`.
- `provenance`: the fingerprint of the saved answers, the interview time and the taxonomy revision.

Each classification records:
- `source`: `founder` (the founder stated it, proven by a quote from their own messages or the files they shared), `ai` (an AI interpretation), `admin` (an admin decision) or `legacy` (from a profile saved before Phase 2; no evidence).
- `status`: `accepted`, `needs_confirmation` or `confirmed_founder`. An admin marks "confirmed with founder" after checking with them; this does not change the source.
- `evidence`: quotes, each with `verified`. A quote is checked against the founder's own messages and what Rupert read in the files they shared in the intake (uploaded materials count as the founder's word), never Rupert's questions or summaries. Comparison ignores case, quote style and spacing; "…" may join parts that appear in order. Quotes under 12 characters never count. An HQ country or state with no quote is accepted when the founder named it in their messages or files.
- `rationale`: why the evidence supports the category. A classification without a verified quote and a rationale of at least 20 characters needs confirmation. So does one with low confidence.

The AI may choose only active taxonomy categories, excluding groups and the generalist marker. Anything else is rejected. If the profile fields already had a value, it is kept, unconfirmed.

## Readiness (displayed only in Phase 2)

- **Blocked**: no primary sector, stage or HQ country; an invalid, retired or wrong-dimension category; more than one primary or more than two secondary sectors.
- **Limited match**: a primary sector, stage or HQ country that needs confirmation; a secondary sector without its own verified evidence and justification; a quote not found in the founder's messages or files (until the sector is confirmed with the founder or decided by an admin); a US company without a state; open questions to clarify; checks from the existing converter (for example, stage vs raise).
- **Ready**: none of the above. Info notes, such as a legacy profile or a broad primary sector, don't lower readiness.

The current engine keeps its own rule, unchanged: it needs a stage, a sector and an HQ country.

## Versions

Every change adds a version, and nothing is overwritten:
- `intake_ai`: built from the intake.
- `admin_edit`: profile fields edited, or sectors changed in the Classification panel.
- `admin_confirm`: a classification confirmed with the founder.

When the profile fields change, categories that are unchanged keep their evidence. New or changed ones become admin decisions. A profile saved before Phase 2 has no version: it is shown as a legacy profile, built from its answers, until the next change or rebuild. If the saved answers differ from the latest version (for example, edited elsewhere), the panel shows them merged and flags it. Problems found when the profile was built (for example, an invalid AI category) stay open until an admin decides that classification, or confirms it with the founder.

Changing sectors in the panel also updates the profile fields the engine runs on. A category the engine doesn't know (no provider value maps to it) is listed as "not usable by the current matching engine".

## Interview guide

`prompt.ts` `interviewGuide` is added in code to the editable interview prompt. It tells the interviewer to:
- establish the product and who pays before suggesting any sector;
- keep customers, suppliers and channels apart from the company's own activity;
- suggest two or three names from the taxonomy;
- never widen the sector;
- ask a follow-up and read back when something is unclear.

The guide applies only where `intake_interviews.classification_guide = 1`. That covers new interviews (the column defaults to 1) and interviews the founder had not answered when the migration ran. Interviews already under way keep their original behavior to the end. The product has no restart, so they never switch.

## Interface for Phase 3

```ts
import { loadCompanyProfile } from "@/lib/company-profile/server"; // server
import { matchingProfile } from "@/lib/company-profile/core";      // pure

const loaded = await loadCompanyProfile(supabase, clientId, matchProfileState); // check .ok
const m = matchingProfile(loaded.value.profile, loaded.value.index);
// m.primarySector, m.secondarySectors, m.stage, m.hqCountry, m.hqState,
// m.markets, m.financing, m.firmTypes: taxonomy category ids, never strings.
// m.exclusions, m.readiness, m.issues, m.unconfirmed (category ids still unconfirmed).
// Record loaded.value.version?.version and the taxonomy revision with each match run.
```

Do not assume:
- that a `needs_confirmation` classification is true;
- that a legacy profile has evidence;
- that every sector relationship is approved: use approved ones only (see `lib/match/tiers`);
- that the Korea mapping is confirmed.
