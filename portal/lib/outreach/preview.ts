// Previewing a copy email for one real lead: the dynamic fields filled in
// with that investor's details, so Rupert and the client see how it reads.
// Pure module, safe on the server and in the browser.

import type { CopyEmail } from "../setup.ts";
import { optOutFor, type CopySection, type OtherTier, type TypedGroupCopy } from "./copy.ts";

/** One investor to preview with. Only what the emails use. */
export type PreviewLead = {
  first_name: string;
  person_name: string;
  fund_name: string;
  /** 1 = Core; 2–4 = Sphere, Tier 3, Tier 4. */
  tier: 1 | OtherTier;
  /** A researched fact for Core, once the contact has been written. */
  quick_fact: string | null;
};

/** Leads per copy group (`section:type`), a few each. */
export type PreviewLeads = Record<string, PreviewLead[]>;

/** A piece of a previewed email: plain text, or a filled (or still missing) field. */
export type Segment = { text: string; field?: string; missing?: boolean };

const MISSING_TEXT: Record<string, string> = {
  first_name: "[first name not on file]",
  fund_name: "[fund name]",
  quick_fact: "[their personal line: written for each investor under Core contacts]",
  tier_line: "[why this investor]",
};

function fill(template: string, values: Record<string, string | null | undefined>): Segment[] {
  const out: Segment[] = [];
  for (const part of template.split(/(\{\{\s*[^{}]*?\s*\}\})/g)) {
    if (!part) continue;
    const match = /^\{\{\s*([^{}]*?)\s*\}\}$/.exec(part);
    if (!match) {
      out.push({ text: part });
      continue;
    }
    const field = match[1];
    const value = values[field];
    if (value && value.trim()) out.push({ text: value.trim(), field });
    else out.push({ text: MISSING_TEXT[field] ?? `[${field}]`, field, missing: true });
  }
  return out;
}

export function previewEmail(
  group: TypedGroupCopy,
  section: CopySection,
  index: number,
  lead: PreviewLead,
  optOutLine: string,
): { subject: Segment[]; body: Segment[] } {
  const email: CopyEmail = group.emails[index] ?? { subject: "", body: "" };
  const tier = section === "others" && lead.tier !== 1 ? lead.tier : null;
  const rawLine = tier ? group.tier_lines?.[`${tier}`] ?? "" : "";
  const tierLine = rawLine
    ? fill(rawLine, { fund_name: lead.fund_name })
        .map((s) => s.text)
        .join("")
    : "";
  const values = {
    first_name: lead.first_name,
    fund_name: lead.fund_name,
    quick_fact: lead.quick_fact,
    tier_line: tierLine,
  };
  const optOut = optOutFor(index, optOutLine).trim();
  const body = fill(email.body.trimEnd(), values);
  if (optOut) body.push({ text: `\n\n${optOut}` });
  return { subject: fill(email.subject, values), body };
}

export function tierName(tier: number) {
  return tier === 1 ? "Core" : tier === 2 ? "Sphere" : `Tier ${tier}`;
}
