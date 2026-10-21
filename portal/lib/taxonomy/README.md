# Investor taxonomy

Canonical categories for the Fund Database, how each provider value maps to them,
how sectors relate, and coverage reporting. Admin page: **/admin/taxonomy**.

The Fund Database itself is never changed. Firms keep their raw provider values in
the stored snapshot; their canonical categories are derived from the mappings here.
The same database version and taxonomy revision always give the same result.

## Storage (`portal/supabase/investor_taxonomy.sql`)

| Table | Holds |
|---|---|
| `tax_nodes` | Canonical categories per dimension: sector, stage, geography, financing, firm_type. `parent_id` is for browsing only. |
| `tax_aliases` | One row per distinct raw value per field (`industry`, `vertical`, `stage`, `geography`, `financing`, `firm_type`, `hq_country`, `hq_state`, `region`). `state`: mapped (one or more `node_ids`), unmapped, ignored. `review`: approved, needs_review. `method`: seed, import, manual, ai. `ai_proposal` is a suggestion that is never used until accepted. |
| `tax_edges` | The sector relationship graph. One edge per pair. `directed` = holds from → to only. `origin`: seed, legacy, manual, ai. `review`: approved, needs_review, rejected (kept so it is not proposed again). |
| `tax_changes` | Every insert/update/delete on the three tables above, written by a trigger, with the row before and after and the actor. The latest id is the **taxonomy revision**. |
| `tax_coverage_runs` | One coverage report per (fund database version, taxonomy revision), plus every firm's mapping in storage (`fund-database/taxonomy/<version>/r<revision>.json.gz`). |

Raw values are compared by `rawKey()` (Unicode-normalized, lowercase, single spaces,
no spaces around `/ & - ,`), so spelling and spacing variants are one value.

## Sector relationships

Closest first. No edge means no established relationship.

| Relation | Meaning | Proposed tier use (decided in Phase 3) |
|---|---|---|
| same category | The firm has the company's sector | Core |
| `equivalent` | Interchangeable labels: an investor in one invests in the other | Core |
| `immediate` | Direct neighbours: specialists in one routinely invest in the other | Sphere |
| `broad` | Same sector family: investors across the family would consider it | Tier 3 |
| `weak` | A real but distant link worth stating (shared customers or technology) | Tier 4 |

Every edge carries a rationale, source, origin and review status; `context` records
when it only holds under conditions. Only approved edges should be relied on for
confirmed matches. Sector groups never imply a relationship.

Seed: the 103 relationships come from the current match engine (`V_ADJ` → immediate,
`V2I` → broad), all `needs_review`, because the engine recorded no rationale.

## Processing

- **Upload preview**: a staged workbook lists values the taxonomy has not seen.
- **Apply** (workbook or CSV): runs a coverage run for the new live version.
- **Coverage run** (`runCoverage`, also "Recompute coverage"): registers unseen values
  as `unmapped` (existing rows are never touched), maps every firm, stores the report.
- **Generalists**: a firm listing "Diversified" or 15+ industries is flagged as a
  generalist; "Diversified" is not a sector and has no relationships.
- **HQ state** is only read for US firms.

## Interface for matching (Phase 2 and 3)

```ts
import { loadTaxonomy } from "@/lib/taxonomy/server";      // server: cached by revision
import { mapFirm, firmSectors, relationBetween } from "@/lib/taxonomy/core"; // pure

const index = (await loadTaxonomy(supabase)).value;          // check .ok first
const mapping = mapFirm(firm, index);
// mapping.tags: { nodeId, field, dimension, raw, review, method }[]
// mapping.status[field]: missing | normalized | partial | unmapped
// mapping.issues: missing | unmapped | needs_review | ignored | broken
// mapping.generalist / generalistWhy
const sectors = firmSectors(mapping, index);                 // canonical sector ids, no generalist marker
const link = relationBetween(index, companySector, firmSector);
// null, or { relation: "same" | "equivalent" | "immediate" | "broad" | "weak", edge, review }
// index.taxonomy.revision: record it with every match run.
```

Do not assume: needs-review mappings and relationships are facts; an unmapped value
means the firm doesn't have that criterion; geography containment (`parent_id`,
`attrs.memberOf`) means a firm investing in a region invests in every country in it.
Those are eligibility policies for Phase 3.
