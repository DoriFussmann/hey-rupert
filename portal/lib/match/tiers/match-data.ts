// "Download match data": every fund in the live Fund Database, with its raw
// provider values and the taxonomy categories they map to, exactly as the
// engine sees them (mapFirm). Pure module: no server code.

import type { FundDb } from "../engine/index.mjs";
import { mapFirm, rawValues, type FieldKey, type TaxIndex } from "../../taxonomy/core.ts";

/** The fields matching reads, in funnel order. */
export const MATCH_DATA_FIELDS: { key: FieldKey; label: string }[] = [
  { key: "financing", label: "Financing" },
  { key: "stage", label: "Stage" },
  { key: "geography", label: "Geography" },
  { key: "industry", label: "Industry" },
  { key: "vertical", label: "Vertical" },
  { key: "firm_type", label: "Type of Firm" },
];

const PARTS = ["raw", "approved", "needs review", "not mapped or broken", "ignored"] as const;

export function matchDataHeader() {
  return [
    "FirmID",
    "Row",
    "Firm name",
    "HQ country (raw)",
    "Hidden for all clients",
    "Generalist",
    ...MATCH_DATA_FIELDS.flatMap((field) => PARTS.map((part) => `${field.label}: ${part}`)),
  ];
}

const join = (values: string[]) => Array.from(new Set(values)).join("; ");

/** One row per Fund Database record, in database order. */
export function matchDataRows(db: FundDb, index: TaxIndex, suppressed: Record<string, string> = {}) {
  const label = (id: string) => index.nodes.get(id)?.label ?? id;
  const seen = new Map<string, number>();
  return db.firms.map((firm) => {
    const row = (seen.get(firm.id) ?? 0) + 1;
    seen.set(firm.id, row);
    const mapping = mapFirm(firm, index);
    const cells: (string | number)[] = [
      firm.id,
      row,
      firm.name,
      firm.country,
      suppressed[firm.id] ?? "",
      mapping.generalist ? mapping.generalistWhy ?? "yes" : "",
    ];
    for (const { key } of MATCH_DATA_FIELDS) {
      const tags = mapping.tags.filter((tag) => tag.field === key);
      const issues = mapping.issues.filter((issue) => issue.field === key);
      cells.push(
        join(rawValues(firm, key)),
        join(tags.filter((tag) => tag.review === "approved").map((tag) => label(tag.nodeId))),
        join(tags.filter((tag) => tag.review !== "approved").map((tag) => `${label(tag.nodeId)} ← "${tag.raw}"`)),
        join(issues.filter((i) => i.kind === "unmapped" || i.kind === "broken").map((i) => i.raw ?? "")),
        join(issues.filter((i) => i.kind === "ignored").map((i) => i.raw ?? "")),
      );
    }
    return cells;
  });
}
