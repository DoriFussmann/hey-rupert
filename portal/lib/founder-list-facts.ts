// The facts the founder list email is written from. Pure module.
//
// The code decides every fact; the managed prompt only decides how to say
// them. Only funds on this founder's list are counted or named, the Core
// funds named are picked here (at most five), and the verification figures
// come with a fixed definition. Nothing internal (scores, review notes,
// excluded or unresolved funds) is included.

import { fitTiersFor, type InvestorListPayload, type InvestorRow, type InvestorVerification } from "./setup.ts";

/** Core funds the email may name. */
export const NAMED_CORE_MAX = 5;

export const BROAD_LABEL = "Also worth considering: broad investors";

/** The confirmed campaign plan behind the list, when there is one. */
export type ListPlan = { months: number; fundsRequired: number; planned: number };

export type ListFacts = {
  total: number;
  tiers: { label: string; detail: string; funds: number; percent: number }[];
  broad: { funds: number; percent: number };
  named: { name: string; facts: string }[];
  verification: { checked: number; valid: number; percent: number; sample: number; checkedOn: string } | null;
};

/** Funds the founder sees: not hidden as a duplicate, not excluded by the founder. */
function onList(list: InvestorListPayload) {
  return list.rows.filter((row) => !row.hidden_duplicate && !list.client_flags?.[row.id]?.excluded);
}

function percentOf(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

/** "VC · Boston, MA. Matched on stage: Seed; sector: Fintech; geo: United States." From the list row only. */
function rowFacts(row: InvestorRow) {
  const place = [row.fund_type, row.location].filter(Boolean).join(" · ");
  const matched = (row.reasons ?? []).map((reason) => reason.replace(/^(\w+):/, (_, word: string) => `${word.toLowerCase()}:`)).join("; ");
  return [place, matched ? `Matched on ${matched}.` : ""].filter(Boolean).join(". ");
}

function verificationOf(value: InvestorVerification | undefined): ListFacts["verification"] {
  if (!value?.verification_ran) return null;
  const checked = value.emails_checked ?? 0;
  if (checked <= 0) return null;
  const valid = value.emails_valid ?? 0;
  return {
    checked,
    valid,
    percent: percentOf(valid, checked),
    sample: value.sample_size ?? 0,
    checkedOn: (value.verified_at ?? "").slice(0, 10),
  };
}

/** The facts of a list, for the email and for tests. */
export function listFacts(list: InvestorListPayload): ListFacts {
  const rows = onList(list);
  const total = rows.length;
  const tiers = fitTiersFor(list.tier_scheme).map((tier) => {
    const funds = rows.filter((row) => row.tier === tier.tier && !row.broad).length;
    return { label: tier.label, detail: tier.detail, funds, percent: percentOf(funds, total) };
  });
  const broadFunds = rows.filter((row) => row.broad).length;
  const named = rows
    .filter((row) => row.tier === 1 && !row.broad)
    .slice(0, NAMED_CORE_MAX)
    .map((row) => ({ name: row.fund_name, facts: rowFacts(row) }));
  return {
    total,
    tiers,
    broad: { funds: broadFunds, percent: percentOf(broadFunds, total) },
    named,
    verification: verificationOf(list.verification),
  };
}

/** The facts as the email prompt receives them. */
export function listFactsText(facts: ListFacts, plan: ListPlan | null) {
  const lines: string[] = [];
  lines.push("## The list");
  lines.push(`${facts.total} investor firms.`);
  if (plan) {
    lines.push(
      `Why this number: the campaign is planned for ${plan.months} month${plan.months === 1 ? "" : "s"}, and the outreach can work through ${plan.fundsRequired} firms in that time. The confirmed plan has ${plan.planned} firms.`,
    );
  }
  lines.push("## Funds per tier (share of the list)");
  for (const tier of facts.tiers) lines.push(`${tier.label}: ${tier.funds} (${tier.percent}%). ${tier.detail}`);
  if (facts.broad.funds > 0) {
    lines.push(
      `${BROAD_LABEL}: ${facts.broad.funds} (${facts.broad.percent}%). Investors with broader mandates, listed separately; not sector-specific matches.`,
    );
  }
  lines.push(`## Core funds you may name (only these, at most ${NAMED_CORE_MAX})`);
  if (facts.named.length === 0) lines.push("None: do not name any fund.");
  facts.named.forEach((fund, index) => lines.push(`${index + 1}. ${fund.name}: ${fund.facts}`));
  lines.push("## Email verification");
  if (facts.verification) {
    const v = facts.verification;
    lines.push(
      `Checked ${v.checkedOn || "before sharing"}, on a sample of ${v.sample} contacts: ${v.valid} of ${v.checked} email addresses checked were verified deliverable (${v.percent}%).`,
    );
    lines.push(
      "Definition: verified deliverable means the recipient's mail server accepted the address when it was checked. It does not guarantee that an email is delivered, read or answered.",
    );
  } else {
    lines.push("No verification results for this list. Do not mention email checks.");
  }
  return lines.join("\n");
}
