# Four-tier matching (Phase 3)

A deterministic engine that places every eligible fund in exactly one of four tiers by sector proximity. It reads the Phase 1 taxonomy (`lib/taxonomy`) and the Phase 2 company profile (`lib/company-profile`).

**Sprint 3A status: preview only.** The engine runs alongside the current one (`lib/match/engine`). The live Match page, the founder pages and the exports still use the current engine.

| What | Where |
|---|---|
| Admin preview | `/admin/matching` |
| Comparison for one client | `/admin/clients/[id]/match/compare` |
| Duplicate report | `/admin/matching/duplicates` |

Rules version: `RULES_VERSION` in `core.ts`. It is recorded with every run. Change it whenever a rule changes.

## Order of checks

Every firm ends with one status:

- `tiered`: in one of the four tiers.
- `excluded`: fails a check.
- `unresolved`: data missing or unclear.
- `generalist`: set aside in its own group.

Each status carries the deciding reason code (`REASONS` in `core.ts`) and a check-by-check record of the values used.

| # | Rule | Behavior |
|---|---|---|
| 1 | Data corrections | Applied to the Fund Database first, as today. |
| 2 | Client exclusions | Exact name, website domain, or "name contains" for terms over 3 characters. Uses the same exclusion text as the current engine. → `client_exclusion` |
| 3 | Hidden for all clients | → `hidden_all` |
| 4 | Firm type | The client's chosen types, or the current engine's defaults for the stage. Read through approved firm-type mappings.<br>• No type → `firm_type_missing`<br>• A value with no approved mapping → `firm_type_unrecognized`<br>• A known type that isn't wanted → `firm_type_mismatch` |
| 4a | Funds of funds | Financing maps to `financing.fund_of_funds` (provider value "Fund of Funds"). Excluded unless there is an approved exception in `match_fof_exceptions`. → `fof_no_exception` |
| 5 | Financing | The client's instruments, default Equity.<br>• None stated → `financing_missing`<br>• Values with no approved mapping → `financing_unrecognized`<br>• Known values that don't match → `financing_mismatch` |
| 6 | Stage | The fund must list the company's stage, using approved stage mappings (a value such as "Early Stage" can cover several stages).<br>• One rung away on the venture ladder → `stage_one_off` (excluded, counted)<br>• Any other stage → `stage_mismatch`<br>• No stage → `stage_not_stated` (unresolved)<br>• Values unmapped or under review → `stage_ambiguous` (unresolved) |
| 7 | Geography | See below. |
| 8 | Optional filters | No platforms (8+ stages), needs a decision maker, needs an email, founded after a year, minimum data confidence, team near you. Same rules as today, using the current engine's contact ranking. → `filter_*` |
| 9 | Generalists | "Diversified", or 15 or more industries → `generalist`. Kept out of the tiers and saved for Phase 4. |
| 10 | Duplicates | Flagged only (`possible_duplicate`). Nothing is merged in Sprint 3A. |
| 11 | Sector tier | See the table below. |
| — | Website check | Runs after tiering, as today: each tier's top funds are checked (the current setting decides how many). A dead, parked or "not investing" site → `dead_website`. |
| — | Client "no" reviews | The fund stays in its tier, marked rejected, and isn't counted. |

The tightness controls and the 100-fund wave limit don't exist in this engine. The current engine keeps them.

## Geography

Only the fund's stated investment geography counts (the provider's Geography field), and only values whose mapping is approved.

**The hierarchy:**
- Region (North America, Europe, Asia, Middle East, Africa, Latin America).
- Europe's subregions. A country can belong to two: `attrs.memberOf`.
- Country, with the provider's grouping kept (Australia and New Zealand sit under Asia).
- US region, then US state.
- Puerto Rico sits under the United States, outside every US region.

**Eligible:**

| Coverage | When |
|---|---|
| National | The fund lists the HQ country. |
| Regional | The fund lists a region or subregion that contains the country. |
| US regional | The fund lists the US region that contains the company's state. |

A value elsewhere never cancels coverage. When a covering value sits next to an unmapped or under-review value, the fund passes with the note `geo_review_note`.

**Not eligible.** These are checked in order once nothing covers the company:

| Reason | Status | When |
|---|---|---|
| `geo_not_stated` | Unresolved | No geography listed, or only values with no geographic meaning. |
| `geo_ambiguous` | Unresolved | Some values are unmapped or under review. |
| `geo_company_state_unknown` | Unresolved | US company with no state; the fund lists US regions. |
| `geo_us_other_regions` | Unresolved | US company; the fund lists US regions and none contains the company's state. Shown as "US focus stated as other regions only". |
| `geo_office_only` | Unresolved | An office or a team member is in the HQ country, but the stated geography doesn't cover it. |
| `geo_outside` | Excluded | Everything else. |

The fund's own HQ and the company's other markets are never used.

## Sector tiers

The only relationships used are those in `tax_edges` with `review = 'approved'`. Directed relationships hold from the company's sector to the fund's sector only. Rejected relationships and those under review never place a fund.

| Tier | From the primary sector | From a secondary sector |
|---|---|---|
| Core | Same, or equivalent | — |
| Sphere | Immediate | Same, or equivalent |
| Tier 3 | Broader | Immediate |
| Tier 4 | Weak | Broader |
| None | Rejected / none | Weak / rejected / none |

- The fund takes its strongest tier. In a tie, the primary sector wins.
- Only the fund's approved sector mappings count.
- No approved link:
  - If the fund has sector values that are unmapped or under review → `sector_ambiguous` (unresolved).
  - Otherwise → `no_sector_link` (excluded).
- No industry and no vertical at all → `sector_not_stated` (excluded).

**Order within a tier:** the fit score, then data confidence, then founding year, then FirmID. The fit score uses the same parts and weights as the current engine, fed by the canonical checks:
- Stage 20.
- Sector 20 (×0.8 when the link comes from a secondary sector).
- Geography 14 (×0.8 for regional coverage).
- Thesis focus 16.
- Stage focus, team near you, reachable decision maker, fund freshness, and both sector fields: 6 each.

## Profile

- A Blocked profile can't run.
- A Limited profile runs. Every unresolved or unconfirmed point is listed with the check it affects (`profileWarnings`).

## Saved runs

`supabase/match_tiers.sql`:

- **`match_runs`:** one row per run. It records the engine and rules version, profile version and inputs, taxonomy revision, Fund Database version, settings, counts, and who ran it and when.
- **`match_run_results`:** one row per fund per run. It records the status, tier, reason codes, the explanation, the score and the position. A repeated FirmID is stored as `id#2`.
- **Permanent:** triggers reject every update, delete and truncate on both tables, for every role. The app's roles have no write privileges on them. Runs are saved only through `match_begin_run` and `match_add_results`, which add rows to a run during its first 30 minutes and never more than it announced.
- **Clients:** runs aren't tied to the client by a foreign key, so they survive client deletion and sandbox resets. A sandbox reset records a marker in `match_sandbox_resets`, and the comparison page shows only runs since the last one.
- **Fund-of-funds exceptions:** `match_fof_exceptions`. Every change is logged in `match_fof_changes`, which is append-only.

The comparison page rebuilds everything from the stored results (`compare.ts`). A saved comparison shows exactly what was computed.

## Duplicates (read-only)

`duplicates.ts` grades candidate groups:

| Level | Rule |
|---|---|
| Same provider ID | The same FirmID appears more than once. |
| Certain | Same normalized name (legal suffixes dropped), same website domain and same HQ country. |
| Likely | Same domain and country, different names. |
| Ambiguous | Same name, but a different or missing domain, or a different country. |

The report is computed on request and never stored. In Sprint 3A, duplicates are only flagged in results.
