// Fixed instructions and tool schema for classifying a company against the
// Phase 1 taxonomy. These are code, not admin-editable prompts, so the rules
// that keep founder facts, AI interpretation and evidence apart can't drift.

import type { TaxIndex } from "../taxonomy/core.ts";
import { COUNTRY_KINDS, SECTOR_KINDS, STAGE_KINDS, choosable } from "./core.ts";

const ID_LIST = (items: { id: string; label: string }[]) => items.map((n) => `${n.id}: ${n.label}`).join("\n");

/** Rules for the profile-building AI, with the categories it may choose from. */
export function classificationRules(index: TaxIndex) {
  const sectors = choosable(index, "sector", SECTOR_KINDS);
  const specific = sectors.filter((n) => n.attrs.granularity !== "broad");
  const broad = sectors.filter((n) => n.attrs.granularity === "broad");
  return [
    "## Classifying the company (fixed rules)",
    "Also fill `classification`. It is checked by code, so follow these rules exactly.",
    "1. First establish what the company itself builds or sells (`product`) and who pays for it (`customers`), each with the founder's exact words as evidence.",
    "2. The company's sector is what the company does, never its customers' industry, its suppliers' or its sales channels'. A payments tool sold to clinics is fintech, not healthtech. List industries the founder mentioned that are not the company's own in `not_company_sectors`, with the reason.",
    "3. `primary_sector`: the most specific category the evidence supports. Use a broad industry only when no specific sector fits. Up to two `secondary_sectors`, only for a real second line of business, each with its own evidence. Never add a sector to reach more investors.",
    "4. `evidence`: exact quotes copied word for word from the founder's own messages in the transcript, or from what their shared files say (the \"[The founder shared …]\" notes in their messages). Not Rupert's questions, not the summary, not the onboarding facts. Code checks every quote against the founder's messages and files; a quote that isn't there is discarded.",
    "5. `rationale`: explain why that evidence supports that category, in one or two sentences. A quote without a reason does not count.",
    "6. `founder_stated`: true only when the founder said it themselves (for example \"we're a fintech\"). If you inferred it, false.",
    "7. `confidence`: high, medium or low. Use low whenever the founder's words could fit another category.",
    "8. Stage and HQ country follow the same rules. If something is unclear or contradicts another answer, add it to `ambiguities` as a question to ask the founder, and do not guess.",
    "9. Use only the category ids below.",
    "",
    "Specific sectors:",
    ID_LIST(specific),
    "",
    "Broad industries (only when no specific sector fits):",
    ID_LIST(broad),
    "",
    "Stages:",
    ID_LIST(choosable(index, "stage", STAGE_KINDS)),
    "",
    "Countries:",
    ID_LIST(choosable(index, "geography", COUNTRY_KINDS)),
  ].join("\n");
}

const CLASS_SCHEMA = {
  type: "object",
  properties: {
    node_id: { type: "string", description: "A category id from the lists." },
    founder_stated: { type: "boolean" },
    evidence: { type: "array", items: { type: "string" }, description: "Exact quotes from the founder's messages or their shared files." },
    rationale: { type: "string", description: "Why the evidence supports this category." },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["node_id", "founder_stated", "evidence", "rationale", "confidence"],
};

/** The `classification` property added to the profile tool. */
export const CLASSIFICATION_PROPERTY = {
  type: "object",
  description: "The company's classification against the taxonomy. Follow the fixed rules.",
  properties: {
    product: { type: "string", description: "What the company itself builds or sells, in plain words." },
    product_evidence: { type: "array", items: { type: "string" } },
    business_model: { type: "string" },
    customers: { type: "string", description: "Who pays for it." },
    customers_evidence: { type: "array", items: { type: "string" } },
    not_company_sectors: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, reason: { type: "string" } },
        required: ["label", "reason"],
      },
    },
    primary_sector: CLASS_SCHEMA,
    secondary_sectors: { type: "array", items: CLASS_SCHEMA, maxItems: 2 },
    stage: CLASS_SCHEMA,
    hq_country: CLASS_SCHEMA,
    ambiguities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string", enum: ["sector", "stage", "geography", "other"] },
          question: { type: "string" },
        },
        required: ["topic", "question"],
      },
    },
  },
  required: ["product", "customers", "primary_sector", "stage", "hq_country"],
};

/**
 * Added to the founder interview for interviews that use the classification
 * guide (new interviews; ones already under way keep their behavior).
 */
export function interviewGuide(index: TaxIndex | null) {
  const lines = [
    "## Understanding the company's sector (fixed)",
    "- Before suggesting any sector, make sure you know what the company itself builds or sells and who pays for it. If either is unclear, ask.",
    "- Keep the company's own activity apart from its customers' industries, its suppliers and its sales channels: a payments tool sold to clinics is fintech, not healthtech.",
    "- Then suggest two or three sector names from the list below, in plain words, most specific first, and ask which fits best and whether there is a second one. Never read out the whole list, and never offer a name that isn't on it; if nothing fits, ask the founder to describe it in their own words.",
    "- Never widen the company's sector to reach more investors.",
    "- If the round, the HQ location or the sector is unclear or conflicts with something said earlier, ask one short follow-up, then read back what you understood and ask the founder to confirm.",
  ];
  if (index) {
    const sectors = choosable(index, "sector", SECTOR_KINDS);
    lines.push(
      "",
      `Sector names: ${sectors.filter((n) => n.attrs.granularity !== "broad").map((n) => n.label).join(", ")}.`,
      `Broad industries, only if nothing above fits: ${sectors.filter((n) => n.attrs.granularity === "broad").map((n) => n.label).join(", ")}.`,
    );
  }
  return lines.join("\n");
}
