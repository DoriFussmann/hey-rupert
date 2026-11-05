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
export function summaryFactsText(matching: Summary, landscape: Summary | null, peersOverview: Summary | null = null): string {
  const lines: string[] = [];
  const s1 = stepOf(matching, "step1");
  const s2a = stepOf(matching, "step2a");
  const s2b = stepOf(matching, "step2b");
  const s2c = stepOf(matching, "step2c");
  // Rosters and Plans: Step 4 and 5 since Step 3 (Companies Like You); Step 3 and 4 before.
  const byTitle = (title: string) => matching.steps.find((x) => x.title === title);
  const s3 = byTitle("The Final Roster");
  const s4 = byTitle("The Plan");
  const s3a = stepOf(matching, "step3a");
  const s3c = stepOf(matching, "step3c");
  // Since the summary shows Steps 2 and 3 as one step each.
  const s2 = stepOf(matching, "step2");
  const s3x = stepOf(matching, "step3");
  const row = (step: SummaryStep, label: string) => cellText(step.tables[0].rows.find((r) => cellText(r.result) === label)?.investors) || "0";
  const layerLines = (step: SummaryStep, what: string) => [
    `${row(step, what)} researched, and the ${row(step, "Investors behind them")} investors behind them.`,
    `${step.headline?.value ?? 0} investors added to the founder's list from them (${row(step, "Brought back from the database")} brought back from the database, ${row(step, "New, added to the database")} new to the database); ${row(step, "Already on the short list")} were already on the short list.`,
  ];

  lines.push("## How the database was narrowed (Step 1)");
  if (s1) {
    const t = s1.tables[0];
    const all = t.rows[0] ? cellText(t.rows[0].left) : "";
    lines.push(`Started from ${all} funds.`);
    for (const r of t.rows.slice(1)) lines.push(`${cellText(r.step)} (${cellText(r.chosen)}): ${cellText(r.left)} left.`);
    lines.push(`Short list: ${s1.headline?.value ?? cellText(t.total?.left)} funds that invest in the company's financing type, stage, geography and sector.`);
  }

  lines.push("## The competitive landscape research (Step 2)");
  if (s2) {
    lines.push(...layerLines(s2, "Funded competitors researched"));
  } else if (s2a && s2b && s2c) {
    lines.push(`${s2a.headline?.value ?? 0} funded direct competitors researched, and the ${s2b.headline?.value ?? 0} investors behind them.`);
    lines.push(`${s2c.headline?.value ?? 0} of those investors were used in the match (already on the short list, or brought back because they fit).`);
  } else {
    lines.push("No funded competitors were found: the matching ran on the database alone. Don't mention competitor research.");
  }

  if (s3x) {
    lines.push("## Companies like you (Step 3): not competitors, but the same bet for investors");
    lines.push(...layerLines(s3x, "Companies like you researched"));
    const named = row(s3x, "Investors you named");
    if (named !== "0") lines.push(`${named} investors the founder named were included.`);
    const peers = stepOf(peersOverview, "peers");
    if (peers) lines.push(`Companies like you that you may name (at most ${NAMED_COMPETITORS_MAX}): ${peers.tables[0].rows.slice(0, NAMED_COMPETITORS_MAX).map((r) => cellText(r.name)).join(", ")}.`);
  } else if (s3a) {
    lines.push("## Companies like you (Step 3)");
    lines.push(
      `${s3a.headline?.value ?? 0} funded comparable companies (not competitors, but the same bet for investors) researched; ${s3c?.headline?.value ?? 0} of their investors, and of those the founder named, were used in the match.`,
    );
    lines.push(`Comparable companies you may name (at most ${NAMED_COMPETITORS_MAX}): ${s3a.tables[0].rows.slice(0, NAMED_COMPETITORS_MAX).map((r) => cellText(r.name)).join(", ")}.`);
  }

  lines.push("## The Final Roster");
  if (s3) {
    lines.push(`${s3.headline?.value ?? 0} investors, after the founder's exclusions.`);
    const backed = s3.tables[1]?.rows[0];
    if (backed) lines.push(`${cellText(backed.investors)} of them backed one of the competitors.`);
    const like = s3.tables[1]?.rows.find((r) => cellText(r.what) === "Backed a comparable company");
    if (like) lines.push(`${cellText(like.investors)} backed a comparable company.`);
    const named = s3.tables[1]?.rows.find((r) => cellText(r.what) === "Named by you");
    if (named) lines.push(`${cellText(named.investors)} are investors the founder named.`);
  }

  lines.push("## The campaign plan");
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
      const like = detail(d, "Backed a comparable company");
      const named = detail(d, "Named by you").length > 0;
      const facts = [
        `${cellText(row.tier)}`,
        matched.length ? `invests in ${matched.join(", ")}` : "",
        backed.length ? `backed ${backed.join(", ")}` : "",
        like.length ? `backed ${like.join(", ")} (comparable)` : "",
        named ? "the founder asked for it" : "",
      ].filter(Boolean);
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
