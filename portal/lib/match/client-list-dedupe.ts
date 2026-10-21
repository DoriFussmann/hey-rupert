import {
  FIT_TIERS,
  type InvestorListPayload,
  type InvestorListSummary,
  type InvestorRow,
} from "@/lib/setup";
import { firmsToKeep, listedContacts } from "@/lib/match/outreach-dedupe";

/** Marks same-domain duplicates and recounts tiers from the rows the client will see. */
export function clientFacingList(list: InvestorListPayload): InvestorListPayload {
  const keep = firmsToKeep(
    list.rows.map((row) => ({
      id: row.id,
      web: row.website ?? "",
      contacts: listedContacts(row.contact_count, row.contact),
    })),
  );
  const rows = list.rows.map((row) => {
    if (keep.has(row.id)) {
      if (!row.hidden_duplicate) return row;
      const rest = { ...row };
      delete rest.hidden_duplicate;
      return rest;
    }
    return { ...row, hidden_duplicate: true };
  });
  return { ...list, rows, summary: summaryForClient(rows, list.summary) };
}

export function visibleFundCount(rows: { hidden_duplicate?: boolean }[]) {
  return rows.filter((row) => !row.hidden_duplicate).length;
}

function summaryForClient(
  rows: InvestorRow[],
  previous: InvestorListSummary | null | undefined,
): InvestorListSummary {
  return {
    generated_at: previous?.generated_at || new Date().toISOString(),
    tiers: FIT_TIERS.map(({ tier }) => {
      const inTier = rows.filter((row) => row.tier === tier && !row.hidden_duplicate);
      const types = new Map<string, { funds: number; contacts: number }>();
      for (const row of inTier) {
        const label = row.fund_type?.trim() || "Other";
        const entry = types.get(label) ?? { funds: 0, contacts: 0 };
        entry.funds += 1;
        entry.contacts += row.contact_count ?? 0;
        types.set(label, entry);
      }
      return {
        tier,
        funds: inTier.length,
        contacts: inTier.reduce((sum, row) => sum + (row.contact_count ?? 0), 0),
        by_type: Array.from(types.entries())
          .map(([label, value]) => ({ label, ...value }))
          .sort((a, b) => b.funds - a.funds || a.label.localeCompare(b.label)),
      };
    }),
  };
}
