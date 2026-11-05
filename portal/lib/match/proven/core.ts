// Proven sectors and stages: what a fund actually invested in is proof of
// what it invests in. Every investment recorded in Step 2C / 3C (the fund,
// the company, the company's sub-sectors, the round) adds the company's
// sub-sectors and the round's stage to the fund's record when the database
// is loaded for matching. The provider file is never edited: re-uploads keep
// it, and removing an investment removes what it proved. Pure module.

import { createHash } from "node:crypto";

export type ProvenInvestment = {
  firmId: string;
  company: string;
  /** The company's sub-sectors, taxonomy labels. */
  sectors: string[];
  /** The round as researched, free text ("$4M Seed (led) and $17M Series A"). */
  round: string;
};

/** What a fund's investments prove, by label, with the companies that prove it. */
export type Proof = {
  sectors: Map<string, string[]>;
  stages: Map<string, string[]>;
};

/** The venture stages a round's text names, as taxonomy labels. Nothing for debt, "undisclosed" and the like. */
export function stagesFromRound(round: string): string[] {
  const t = ` ${round.toLowerCase()} `;
  const out: string[] = [];
  if (/pre[-\s]?seed/.test(t)) out.push("Pre-Seed");
  // "Seed" on its own (not only as part of "pre-seed").
  if (/(^|[^-\w])seed\b/.test(t.replace(/pre[-\s]?seed/g, " "))) out.push("Seed");
  if (/series\s*a\b/.test(t)) out.push("Series A");
  if (/series\s*b\b/.test(t)) out.push("Series B");
  if (/series\s*[c-h]\b/.test(t)) out.push("Series C and Beyond");
  if (/\bgrowth\b/.test(t)) out.push("Growth Equity");
  return out;
}

export function proofByFirm(rows: ProvenInvestment[]): Map<string, Proof> {
  const by = new Map<string, Proof>();
  const add = (m: Map<string, string[]>, label: string, company: string) => {
    const list = m.get(label) ?? [];
    if (!list.includes(company)) list.push(company);
    m.set(label, list);
  };
  for (const r of rows) {
    if (!r.firmId) continue;
    const proof = by.get(r.firmId) ?? { sectors: new Map(), stages: new Map() };
    for (const s of r.sectors) if (s) add(proof.sectors, s, r.company);
    for (const s of stagesFromRound(r.round)) add(proof.stages, s, r.company);
    by.set(r.firmId, proof);
  }
  return by;
}

/** The firm fields proven values go into (raw values, as the provider writes them). */
type ProvenFirm = { id: string; stages: string[]; ind: string[]; vert: string[] };

/**
 * The firms with every proven value added (never removing one). `rawFor` turns
 * a taxonomy label into a raw value the taxonomy maps to it; `sectorField`
 * says whether a sector label is an industry (broad) or a vertical.
 */
export function withProof<F extends ProvenFirm>(
  firms: F[],
  proof: Map<string, Proof>,
  rawFor: (field: string, label: string) => string,
  sectorField: (label: string) => "industry" | "vertical" | null,
): F[] {
  if (!proof.size) return firms;
  const lower = (list: string[]) => new Set(list.map((x) => x.toLowerCase()));
  return firms.map((f) => {
    const p = proof.get(f.id);
    if (!p) return f;
    const stages = [...f.stages];
    const ind = [...f.ind];
    const vert = [...f.vert];
    const has = { stages: lower(stages), ind: lower(ind), vert: lower(vert) };
    for (const label of Array.from(p.stages.keys())) {
      const raw = rawFor("stage", label);
      if (!has.stages.has(raw.toLowerCase())) {
        stages.push(raw);
        has.stages.add(raw.toLowerCase());
      }
    }
    for (const label of Array.from(p.sectors.keys())) {
      const field = sectorField(label);
      if (!field) continue;
      const raw = rawFor(field, label);
      const [list, set] = field === "industry" ? [ind, has.ind] : [vert, has.vert];
      if (!set.has(raw.toLowerCase())) {
        list.push(raw);
        set.add(raw.toLowerCase());
      }
    }
    return { ...f, stages, ind, vert };
  });
}

/** Proof in words, for a fund: "Cannabis (backed LeafLink, Nabis)", "Seed (backed Cann)". */
export function proofNotes(p: Proof | undefined): string[] {
  if (!p) return [];
  const line = ([label, companies]: [string, string[]]) => `${label} (backed ${companies.slice(0, 3).join(", ")}${companies.length > 3 ? "…" : ""})`;
  return [...Array.from(p.sectors.entries()).map(line), ...Array.from(p.stages.entries()).map(line)];
}

/** A fingerprint of the investments, so a new one shows as "the data changed since". "" when none. */
export function provenRevision(rows: ProvenInvestment[]): string {
  if (!rows.length) return "";
  const lines = rows.map((r) => `${r.firmId}|${r.company}|${[...r.sectors].sort().join(",")}|${r.round}`).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 12);
}
