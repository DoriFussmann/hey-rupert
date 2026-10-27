import { fitTiersFor, type FitTier, type InvestorListPayload } from "./setup.ts";

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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
      const bullets = lines.filter((line) => line.startsWith("• "));
      if (bullets.length === lines.length && bullets.length > 0) {
        const items = bullets
          .map((line) => `<li style="margin:0 0 8px">${escapeHtml(line.slice(2))}</li>`)
          .join("");
        return `<ul style="margin:0 0 16px;padding-left:20px;font-size:16px;line-height:1.6;color:#2D2D2D">${items}</ul>`;
      }
      return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#2D2D2D">${lines.map(escapeHtml).join("<br>")}</p>`;
    })
    .join("");
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#FAF9F5;color:#2D2D2D;font-family:Inter,Helvetica,Arial,sans-serif">${html}</body></html>`;
}
