// Facts about the campaign for the email that tells the founder their
// outreach emails are ready. Computed here so the numbers are exact; the AI
// only words them. Pure module.

import type { InvestorListPayload } from "../setup.ts";
import { OTHER_TIER_LABEL, copyTierOf, outreachRows, type TypedCopy } from "./copy.ts";
import { perFirmOf, toEmail } from "./core.ts";

export type CampaignFacts = {
  funds: number;
  perFirm: number;
  investors: number;
  byTier: { label: string; funds: number; investors: number }[];
  knownLeftOut: number;
  /** How the copy is written. */
  organisation: "by_type" | "by_tier";
  coreTypes: string[];
  otherTypes: string[];
};

export function campaignFacts(
  list: Pick<InvestorListPayload, "rows" | "client_flags" | "contacts_per_firm">,
  overrides: ReadonlySet<string>,
  typed: TypedCopy | null | undefined,
): CampaignFacts {
  const perFirm = perFirmOf(list);
  const { rows, knownLeftOut } = outreachRows(list, overrides);
  const investorsOf = (subset: typeof rows) => subset.reduce((sum, row) => sum + toEmail(row.contact_count ?? 0, perFirm), 0);
  const labels: Record<number, string> = { 1: "Core", ...OTHER_TIER_LABEL };
  const byTier = [1, 2, 3, 4]
    .map((tier) => {
      const inTier = rows.filter((row) => copyTierOf(row) === tier);
      return { label: labels[tier], funds: inTier.length, investors: investorsOf(inTier) };
    })
    .filter((entry) => entry.funds > 0);
  return {
    funds: rows.length,
    perFirm,
    investors: investorsOf(rows),
    byTier,
    knownLeftOut: knownLeftOut.length,
    organisation: typed ? "by_type" : "by_tier",
    coreTypes: typed?.core.map((group) => group.type) ?? [],
    otherTypes: typed?.others.map((group) => group.type) ?? [],
  };
}

export function campaignFactsText(facts: CampaignFacts) {
  const lines = [
    `Funds the emails go to: ${facts.funds}.`,
    `Contacts emailed per fund: up to ${facts.perFirm} (set in the campaign plan; fewer where a fund has fewer contacts on file).`,
    `Investors who will receive the emails: ${facts.investors}.`,
    `By tier: ${facts.byTier.map((t) => `${t.label} ${t.funds} funds, ${t.investors} investors`).join("; ")}.`,
    facts.knownLeftOut > 0
      ? `Funds the founder marked as known, left out of the emails for them to approach directly: ${facts.knownLeftOut}.`
      : "No funds are left out as known.",
    facts.organisation === "by_type"
      ? `The copy is written by type of investor. Core (${facts.coreTypes.join(", ") || "none"}): each Core investor gets their own version written for that partner from researched facts, reviewed by Rupert. Sphere, Tier 3 and Tier 4 (${facts.otherTypes.join(", ") || "none"}): one set per type of investor, with a line on why that fund. Each set is a first email and two follow-ups. The founder can preview every email as a real investor on their list gets it.`
      : "The copy is written per tier: a first email and two follow-ups for each tier.",
  ];
  return lines.join("\n");
}
