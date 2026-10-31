// Dry Match: the new step-by-step shortlist (Financing → Stage → Geography →
// Primary sector group). Pure module: builds a compact copy of the Fund
// Database for the browser, the company's defaults, and the filter. Only
// approved taxonomy mappings count.

import type { FundDb } from "../engine/index.mjs";
import { GENERALIST_KIND, mapFirm, type TaxIndex } from "../../taxonomy/core.ts";
import { containers } from "../tiers/core.ts";

export const DRY_STEPS = ["financing", "stage", "geography", "sector"] as const;
export type DryStep = (typeof DRY_STEPS)[number];

export const DRY_STEP_LABEL: Record<DryStep, string> = {
  financing: "Financing type",
  stage: "Stage",
  geography: "Geography",
  sector: "Primary sector",
};

/**
 * The geography choices: world regions, with the United States, Canada and
 * Israel on their own. A fund passes a choice when any value it states sits
 * on the same line as the choice: inside it (Germany for Europe, a US region
 * for the United States) or containing it (Middle East for Israel).
 */
export const GEO_BUCKETS = [
  { key: "us", label: "United States", node: "geo.us" },
  { key: "canada", label: "Canada", node: "geo.canada" },
  { key: "israel", label: "Israel", node: "geo.israel" },
  { key: "europe", label: "Europe", node: "geo.europe" },
  { key: "asia", label: "Asia-Pacific", node: "geo.asia" },
  { key: "latin_america", label: "Latin America", node: "geo.latin_america" },
  { key: "middle_east", label: "Middle East", node: "geo.middle_east" },
  { key: "africa", label: "Africa", node: "geo.africa" },
] as const;

/** Pre-Seed and Seed are one stage: choosing either chooses both. */
const EARLY = ["stage.pre_seed", "stage.seed"];

export type DryOption = { id: string; label: string };

/** A fund, compact: every list holds indexes into the options of DryData. */
export type DryFund = {
  id: string;
  name: string;
  fin: number[];
  stage: number[];
  geo: number[];
  /** Geography choices the fund passes (indexes into GEO_BUCKETS). */
  bucket: number[];
  sector: number[];
  group: number[];
  generalist: boolean;
};

export type DryData = {
  options: {
    financing: DryOption[];
    stage: DryOption[];
    geography: DryOption[];
    sector: DryOption[];
  };
  /** Every geography and sector value a fund states, for the fund list. */
  labels: { geo: string[]; sector: string[] };
  funds: DryFund[];
  /** The company's own choices, as option ids. */
  defaults: Record<DryStep, string[]>;
  /** Where each default came from, in words. */
  defaultsFrom: Record<DryStep, string>;
};

export type DryProfile = {
  financing: string[];
  stage: string | null;
  hqCountry: string | null;
  primarySector: string | null;
};

const byLabel = (a: DryOption, b: DryOption) => a.label.localeCompare(b.label);

/** The sector group a sector sits in, following its parents. */
export function groupOf(index: TaxIndex, id: string): string | null {
  let node = index.nodes.get(id);
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    if (node.kind === "group") return node.id;
    node = node.parentId ? index.nodes.get(node.parentId) : undefined;
  }
  return null;
}

/** The geography choices a stated value passes. */
export function bucketsFor(index: TaxIndex, value: string): number[] {
  const up = containers(index, value);
  return GEO_BUCKETS.flatMap((bucket, i) =>
    value === bucket.node || up.has(bucket.node) || containers(index, bucket.node).has(value) ? [i] : [],
  );
}

/** The company's geography choice: its HQ country if it has its own choice, else its region. */
export function defaultBucket(index: TaxIndex, country: string | null): string[] {
  if (!country) return [];
  const own = GEO_BUCKETS.find((bucket) => bucket.node === country);
  if (own) return [own.key];
  const up = containers(index, country);
  const region = GEO_BUCKETS.find((bucket) => up.has(bucket.node));
  return region ? [region.key] : [];
}

export function buildDryData(db: FundDb, index: TaxIndex, profile: DryProfile): DryData {
  const nodesOf = (dimension: string, kinds?: string[]) =>
    Array.from(index.nodes.values())
      .filter((node) => node.dimension === dimension && node.status === "active" && (!kinds || kinds.includes(node.kind)))
      .map((node) => ({ id: node.id, label: node.label }));
  const financing = nodesOf("financing").sort(byLabel);
  const stage = nodesOf("stage", ["stage"]).sort(
    (a, b) => Number(index.nodes.get(a.id)?.attrs.ladder ?? 99) - Number(index.nodes.get(b.id)?.attrs.ladder ?? 99) || byLabel(a, b),
  );
  const sector = nodesOf("sector", ["group"]).sort(byLabel);
  const geography = GEO_BUCKETS.map((bucket) => ({ id: bucket.key, label: bucket.label }));

  const pos = (list: DryOption[]) => new Map(list.map((option, i) => [option.id, i]));
  const finPos = pos(financing);
  const stagePos = pos(stage);
  const groupPos = pos(sector);
  const geoLabels: string[] = [];
  const geoLabelPos = new Map<string, number>();
  const sectorLabels: string[] = [];
  const sectorLabelPos = new Map<string, number>();
  const intern = (labels: string[], at: Map<string, number>, id: string) => {
    let i = at.get(id);
    if (i === undefined) {
      i = labels.length;
      labels.push(index.nodes.get(id)?.label ?? id);
      at.set(id, i);
    }
    return i;
  };
  const bucketCache = new Map<string, number[]>();

  const funds: DryFund[] = db.firms.map((firm) => {
    const mapping = mapFirm(firm, index);
    const approved = (field: string) =>
      Array.from(new Set(mapping.tags.filter((tag) => tag.field === field && tag.review === "approved").map((tag) => tag.nodeId)));
    const geoIds = approved("geography");
    const sectorIds = [...approved("industry"), ...approved("vertical")].filter(
      (id, i, all) => all.indexOf(id) === i && index.nodes.get(id)?.kind !== GENERALIST_KIND,
    );
    const buckets = new Set<number>();
    for (const id of geoIds) {
      let hit = bucketCache.get(id);
      if (!hit) bucketCache.set(id, (hit = bucketsFor(index, id)));
      hit.forEach((b) => buckets.add(b));
    }
    const groups = new Set<number>();
    for (const id of sectorIds) {
      const g = groupOf(index, id);
      const at = g ? groupPos.get(g) : undefined;
      if (at !== undefined) groups.add(at);
    }
    const idx = (ids: string[], at: Map<string, number>) =>
      ids.map((id) => at.get(id)).filter((i): i is number => i !== undefined);
    return {
      id: firm.id,
      name: firm.name,
      fin: idx(approved("financing"), finPos),
      stage: idx(approved("stage"), stagePos),
      geo: geoIds.map((id) => intern(geoLabels, geoLabelPos, id)),
      bucket: Array.from(buckets).sort((a, b) => a - b),
      sector: sectorIds.map((id) => intern(sectorLabels, sectorLabelPos, id)),
      group: Array.from(groups).sort((a, b) => a - b),
      generalist: mapping.generalist,
    };
  });

  const label = (id: string | null) => (id ? index.nodes.get(id)?.label ?? id : "");
  const ownFinancing = profile.financing.filter((id) => finPos.has(id));
  const ownStage = profile.stage && stagePos.has(profile.stage) ? (EARLY.includes(profile.stage) ? EARLY.filter((id) => stagePos.has(id)) : [profile.stage]) : [];
  const ownGroup = profile.primarySector ? groupOf(index, profile.primarySector) : null;
  const ownGeo = defaultBucket(index, profile.hqCountry);
  return {
    options: { financing, stage, geography, sector },
    labels: { geo: geoLabels, sector: sectorLabels },
    funds,
    defaults: {
      financing: ownFinancing.length ? ownFinancing : finPos.has("financing.equity") ? ["financing.equity"] : [],
      stage: ownStage,
      geography: ownGeo,
      sector: ownGroup && groupPos.has(ownGroup) ? [ownGroup] : [],
    },
    defaultsFrom: {
      financing: ownFinancing.length ? `Profile: ${ownFinancing.map(label).join(", ")}` : "Profile has none: Equity",
      stage: profile.stage
        ? `Profile: ${label(profile.stage)}${EARLY.includes(profile.stage) ? " (Pre-Seed and Seed count as one stage)" : ""}`
        : "Profile has no stage",
      geography: profile.hqCountry ? `Profile HQ: ${label(profile.hqCountry)}` : "Profile has no HQ country",
      sector: profile.primarySector
        ? `Profile primary sector: ${label(profile.primarySector)}${ownGroup ? `, in ${label(ownGroup)}` : ""}`
        : "Profile has no primary sector",
    },
  };
}

/** Which fund list a step reads, and whether a fund passes the step's choices. */
const FIELD: Record<DryStep, "fin" | "stage" | "bucket" | "group"> = {
  financing: "fin",
  stage: "stage",
  geography: "bucket",
  sector: "group",
};

/** Expands a stage choice: Pre-Seed and Seed always go together. */
export function expandStage(ids: string[]): string[] {
  return ids.some((id) => EARLY.includes(id)) ? Array.from(new Set([...ids, ...EARLY])) : ids;
}

function wantedSet(data: DryData, step: DryStep, chosen: string[]) {
  const ids = step === "stage" ? expandStage(chosen) : chosen;
  return new Set(ids.map((id) => data.options[step].findIndex((o) => o.id === id)).filter((i) => i >= 0));
}

export function passes(data: DryData, fund: DryFund, step: DryStep, chosen: string[]): boolean {
  const wanted = wantedSet(data, step, chosen);
  return fund[FIELD[step]].some((i) => wanted.has(i));
}

/** The funds left after each confirmed step, in order. */
export function funnel(data: DryData, confirmed: Partial<Record<DryStep, string[]>>) {
  let left = data.funds;
  const steps: { step: DryStep; before: number; removed: number; left: number; funds: DryFund[] }[] = [];
  for (const step of DRY_STEPS) {
    const chosen = confirmed[step];
    if (!chosen) break;
    const before = left.length;
    const wanted = wantedSet(data, step, chosen);
    left = left.filter((fund) => fund[FIELD[step]].some((i) => wanted.has(i)));
    steps.push({ step, before, removed: before - left.length, left: left.length, funds: left });
  }
  return steps;
}
