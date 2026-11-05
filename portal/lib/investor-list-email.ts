import { fitTiersFor, type FitTier, type InvestorListPayload, type InvestorSummaries } from "./setup.ts";
import { cellText } from "./match/summary/core.ts";
import { bulletOf } from "./text-bullets.ts";

const CTA_LABEL = "Review your investor list";

function n(value: number) {
  return value.toLocaleString("en-US");
}

function fundsIn(list: InvestorListPayload, tier: FitTier) {
  const fromSummary = list.summary?.tiers.find((item) => item.tier === tier)?.funds;
  if (typeof fromSummary === "number") return fromSummary;
  return list.rows.filter((row) => row.tier === tier && !row.hidden_duplicate).length;
}

/** First name from the email signature ("Dori\\nHey Rupert"). */
export function adminFirstName(signature: string) {
  const line = signature.split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? "";
  return line.split(/\s+/)[0] || "Dori";
}

/** The investor-list email, filled from the pushed snapshot. Plain text is what Rupert edits. */
export function investorListEmailText({
  list,
  company,
  clientFirstName,
  adminName,
  portalUrl,
}: {
  list: InvestorListPayload;
  company: string;
  clientFirstName: string;
  adminName: string;
  portalUrl: string;
}) {
  const four = list.tier_scheme === "four";
  const total = fitTiersFor(list.tier_scheme).reduce((sum, { tier }) => sum + fundsIn(list, tier), 0);
  const lines = [
    clientFirstName ? `Hi ${clientFirstName},` : "Hi,",
    "",
    `Your matched investor list for ${company} is ready. I ran what you shared about ${company} against our database of 10,000+ funds and narrowed it to ${n(total)} funds, sorted by fit:`,
    "",
    ...(four
      ? [
          `• Core: ${n(fundsIn(list, 1))} funds. They invest directly in your sector. These get the most personal outreach.`,
          `• Sphere: ${n(fundsIn(list, 2))} funds. A sector right next to yours, or one of your other sectors.`,
          `• Tier 3: ${n(fundsIn(list, 3))} funds. A broader link to your sector that widens the funnel.`,
          `• Tier 4: ${n(fundsIn(list, 4))} funds. A weaker but real link, contacted last.`,
          "",
          "Every fund on the list invests at your stage and covers your location.",
        ]
      : [
          `• Bullseye: ${n(fundsIn(list, 1))} funds. Your stage, sector and geography line up. These get the most personal outreach.`,
          `• Match: ${n(fundsIn(list, 2))} funds. Strong fit on most of your criteria.`,
          `• Expansion: ${n(fundsIn(list, 3))} funds. A broader fit that widens the funnel.`,
        ]),
  ];
  const verification = list.verification;
  if (verification?.verification_ran) {
    lines.push(
      "",
      `Before sending this over, I ran a quality check on a sample of ${n(verification.sample_size ?? 0)} contacts: confirmed the firms are active and verified the email addresses. ${n(verification.deliverable_rate ?? 0)}% came back deliverable.`,
    );
  }
  lines.push(
    "",
    `What I need from you (about 10 minutes): start with ${four ? "Core" : "Bullseye"}. Exclude anyone you don't want contacted, mark anyone you already know, then confirm. Outreach starts only after you confirm, and you'll approve every email before anything is sent.`,
    "",
    `[${CTA_LABEL}] → ${portalUrl}`,
    "",
    adminName,
    "Hey Rupert",
  );
  return {
    subject: `Your investor list for ${company} is ready to review`,
    text: lines.join("\n"),
  };
}

/** The letter for the new matching when Claude isn't set up: the headline numbers from the summaries. */
export function matchingSummaryLetter({
  summaries,
  company,
  clientFirstName,
  adminName,
  portalUrl,
}: {
  summaries: InvestorSummaries;
  company: string;
  clientFirstName: string;
  adminName: string;
  portalUrl: string;
}) {
  const step = (key: string) => summaries.matching.steps.find((s) => s.key === key);
  const titled = (title: string) => summaries.matching.steps.find((s) => s.title === title);
  const all = cellText(step("step1")?.tables[0]?.rows[0]?.left);
  const roster = titled("The Final Roster")?.headline?.value ?? 0;
  const plan = titled("The Plan")?.tables[0]?.total;
  const competitors = summaries.landscape?.steps.find((s) => s.key === "competitors")?.headline?.value ?? 0;
  const lines = [
    clientFirstName ? `Hi ${clientFirstName},` : "Hi,",
    "",
    `Your investor matching for ${company} is ready. I started from ${all} funds, narrowed them by your financing type, stage, geography and sector, researched the investors behind your funded competitors, and arrived at a Final Roster of ${n(roster)} investors.`,
    "",
    plan
      ? `This campaign reaches ${cellText(plan.planContacts)} investors at ${cellText(plan.planFunds)} funds, starting with Core: funds that invest directly in your sector. The rest of the roster is kept for later waves.`
      : "",
    "",
    competitors
      ? `I've also included a Competitive Landscape Overview: your ${n(competitors)} funded competitors, their latest rounds, and who backed them.`
      : "",
    "",
    "Please review both in your portal. You can confirm, comment, ask a question or request changes. If you'd like to go through it together, book a short call with \"Book a call\" in the left panel of your portal.",
    "",
    "Outreach starts only after you confirm, and you'll approve every email before anything is sent.",
    "",
    `[Review your investor matching] → ${portalUrl}`,
    "",
    adminName,
    "Hey Rupert",
  ];
  return { subject: `Your investor matching for ${company} is ready to review`, text: lines.join("\n").replace(/\n{3,}/g, "\n\n") };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const P_STYLE = "margin:0 0 16px;font-size:16px;line-height:1.6;color:#2D2D2D";
const UL_STYLE = "margin:0 0 16px;padding-left:20px;font-size:16px;line-height:1.6;color:#2D2D2D";
const SUB_UL_STYLE = "margin:8px 0 0;padding-left:20px;list-style-type:circle";

/** One paragraph block: its plain lines as a paragraph, its bullet lines ("• ", "  ◦ ", "- ") as a list, nested by level. */
function blockHtml(lines: string[]) {
  const out: string[] = [];
  let text: string[] = [];
  let items: { html: string; subs: string[] }[] = [];
  const flushText = () => {
    if (text.length) out.push(`<p style="${P_STYLE}">${text.map(escapeHtml).join("<br>")}</p>`);
    text = [];
  };
  const flushList = () => {
    if (items.length) {
      const li = items
        .map((i) => `<li style="margin:0 0 8px">${i.html}${i.subs.length ? `<ul style="${SUB_UL_STYLE}">${i.subs.map((x) => `<li style="margin:0 0 4px">${x}</li>`).join("")}</ul>` : ""}</li>`)
        .join("");
      // A list right under a line of text sits close to it.
      if (out.length && out[out.length - 1].startsWith("<p")) out[out.length - 1] = out[out.length - 1].replace("margin:0 0 16px", "margin:0 0 8px");
      out.push(`<ul style="${UL_STYLE}">${li}</ul>`);
    }
    items = [];
  };
  for (const line of lines) {
    const b = bulletOf(line);
    if (!b) {
      flushList();
      text.push(line);
      continue;
    }
    flushText();
    if (b.level === 2 && items.length) items[items.length - 1].subs.push(escapeHtml(b.rest));
    else items.push({ html: escapeHtml(b.rest), subs: [] });
  }
  flushText();
  flushList();
  return out.join("");
}

/** HTML for the same letter. The review line becomes a button; everything else is the edited text. */
export function investorListEmailHtml(text: string) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const html = blocks
    .map((block) => {
      const lines = block.split("\n");
      const cta = lines.length === 1 ? lines[0].match(/^\[(.+?)\]\s*→\s*(https?:\/\/\S+)\s*$/) : null;
      if (cta) {
        const label = escapeHtml(cta[1]);
        const href = escapeHtml(cta[2]);
        return `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:#5C7A5E;color:#ffffff;text-decoration:none;font-size:16px;line-height:1.4;padding:12px 20px;border-radius:6px">${label}</a></p>`;
      }
      return blockHtml(lines);
    })
    .join("");
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#FAF9F5;color:#2D2D2D;font-family:Inter,Helvetica,Arial,sans-serif">${html}</body></html>`;
}
