// The facts the founder email is drafted from, read from the summaries pushed
// to the client page (the finalized matching). Pure module. Only what the
// summaries say; nothing is computed afresh.

import { cellText, type Detail, type Summary, type SummaryStep } from "./core.ts";

export const NAMED_FUNDS_MAX = 5;
export const NAMED_COMPETITORS_MAX = 3;

const stepOf = (s: Summary | null, key: string): SummaryStep | undefined => s?.steps.find((x) => x.key === key);
const detail = (details: Detail[] | undefined, label: string) => {
  const d = details?.find((x) => x.label === label);
  if (!d) return [];
  return (Array.isArray(d.value) ? d.value : [d.value]).map((v) => cellText(v)).filter(Boolean);
};

/** The facts as the email prompt receives them. */
export function summaryFactsText(matching: Summary, landscape: Summary | null): string {
  const lines: string[] = [];
  const s1 = stepOf(matching, "step1");
  const s2a = stepOf(matching, "step2a");
  const s2b = stepOf(matching, "step2b");
  const s2c = stepOf(matching, "step2c");
  const s3 = stepOf(matching, "step3");
  const s4 = stepOf(matching, "step4");

  lines.push("## How the database was narrowed (Step 1)");
  if (s1) {
    const t = s1.tables[0];
    const all = t.rows[0] ? cellText(t.rows[0].left) : "";
    lines.push(`Started from ${all} funds.`);
    for (const r of t.rows.slice(1)) lines.push(`${cellText(r.step)} (${cellText(r.chosen)}): ${cellText(r.left)} left.`);
    lines.push(`Short list: ${s1.headline?.value ?? cellText(t.total?.left)} funds that invest in the company's financing type, stage, geography and sector.`);
  }

  lines.push("## The competitive landscape research (Step 2)");
  if (s2a && s2b && s2c) {
    lines.push(`${s2a.headline?.value ?? 0} funded direct competitors researched, and the ${s2b.headline?.value ?? 0} investors behind them.`);
    lines.push(`${s2c.headline?.value ?? 0} of those investors were used in the match (already on the short list, or brought back because they fit).`);
  } else {
    lines.push("No funded competitors were found: the matching ran on the database alone. Don't mention competitor research.");
  }

  lines.push("## The Final Roster (Step 3)");
  if (s3) {
    lines.push(`${s3.headline?.value ?? 0} investors, after the founder's exclusions.`);
    const backed = s3.tables[1]?.rows[0];
    if (backed) lines.push(`${cellText(backed.investors)} of them backed one of the competitors.`);
  }

  lines.push("## The campaign plan (Step 4)");
  if (s4) {
    if (s4.line) lines.push(`Setup: ${s4.line}.`);
    const t = s4.tables[0];
    lines.push(`In the plan: ${cellText(t.total?.planContacts)} contacts at ${cellText(t.total?.planFunds)} funds, of ${cellText(t.total?.funds)} approachable funds on the roster.`);
    lines.push("Tiers: Core = invests in the company's primary sub-sector; Sphere = its first secondary sub-sector; Tier 3 = its second secondary; Tier 4 = only the broader sector. Core is filled first.");
    for (const r of t.rows) {
      lines.push(`${cellText(r.tier)}: ${cellText(r.funds)} approachable funds; ${cellText(r.planFunds)} in the plan (${cellText(r.planContacts)} contacts).`);
    }
    const waiting = t.rows.reduce((sum, r) => sum + (Number(cellText(r.funds).replace(/,/g, "")) - Number(cellText(r.planFunds).replace(/,/g, ""))), 0);
    if (waiting > 0) lines.push(`${waiting.toLocaleString("en-US")} approachable funds don't fit this campaign and are kept for later waves.`);

    // Funds that may be named: those that backed a competitor first, then the top of the plan.
    const roster = s4.tables[1];
    const order = roster.rows
      .map((row, i) => ({ row, d: roster.details?.[i] }))
      .sort((a, b) => Number(detail(b.d, "Backed a competitor").length > 0) - Number(detail(a.d, "Backed a competitor").length > 0));
    const named = order.slice(0, NAMED_FUNDS_MAX);
    lines.push(`## Funds on the outreach list you may name (only these, at most ${NAMED_FUNDS_MAX})`);
    if (!named.length) lines.push("None: do not name any fund.");
    named.forEach(({ row, d }, i) => {
      const backed = detail(d, "Backed a competitor");
      const matched = detail(d, "Matched on");
      const facts = [`${cellText(row.tier)}`, matched.length ? `invests in ${matched.join(", ")}` : "", backed.length ? `backed ${backed.join(", ")}` : ""].filter(Boolean);
      lines.push(`${i + 1}. ${cellText(row.name)}: ${facts.join("; ")}.`);
    });
  }

  lines.push("## The Competitive Landscape Overview (shared with the founder as a bonus)");
  const comp = stepOf(landscape, "competitors");
  const inv = stepOf(landscape, "investors");
  if (comp && inv) {
    const names = comp.tables[0].rows.slice(0, NAMED_COMPETITORS_MAX).map((r) => cellText(r.name));
    lines.push(`${comp.headline?.value ?? 0} funded competitors, with their latest rounds and sources. Competitors you may name (at most ${NAMED_COMPETITORS_MAX}): ${names.join(", ")}.`);
    lines.push(`${inv.headline?.value ?? 0} investors behind them; ${inv.headline?.label.replace(/^Investors, /, "") ?? ""}.`);
  } else {
    lines.push("None this time. Don't mention it.");
  }
  return lines.join("\n");
}
