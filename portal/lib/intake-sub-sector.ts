// The intake's sub-sector question. Pure module: when the founder's answer to
// "where would investors file you?" is a sector (the taxonomy's group, e.g.
// Financial services) or a broad sub-sector (Financial Services), the portal
// asks them to pick one or more sub-sectors from the list under it. If none
// fits, they describe it, the AI suggests the closest sub-sectors for them to
// confirm, and if still none fits, their words go to the admin.

import type { TaxIndex, TaxNode } from "./taxonomy/core.ts";
import { SECTOR_KINDS } from "./company-profile/core.ts";
import { groupOf } from "./match/dry/core.ts";
import { covered } from "./match/plan/core.ts";

export type SubSectorOption = { id: string; label: string };
export type SubSectorSuggestion = SubSectorOption & { why: string };

/**
 * - open: the founder is picking from the list.
 * - describe: none fitted; the founder is describing it in their own words.
 * - suggested: the AI suggested the closest sub-sectors; the founder confirms.
 * - picked: done, the founder chose `chosen`.
 * - unmatched: done, nothing fitted; `description` went to the admin.
 */
export type SubSectorStatus = "open" | "describe" | "suggested" | "picked" | "unmatched";

export type SubSectorPick = {
  status: SubSectorStatus;
  /** What the founder said: the sector or broad sub-sector. */
  asked: SubSectorOption[];
  /** The sub-sectors under it, to pick from. */
  options: SubSectorOption[];
  description: string;
  suggestions: SubSectorSuggestion[];
  chosen: SubSectorOption[];
  at: string;
};

export const SUB_SECTOR_LIMITS = { descriptionMax: 600, pickMax: 3 };

export function isSubSectorDone(pick: SubSectorPick | null) {
  return pick?.status === "picked" || pick?.status === "unmatched";
}

const option = (n: TaxNode): SubSectorOption => ({ id: n.id, label: n.label });
const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/^the /, "");

/** Sub-sectors a client can pick (active sector nodes, specific or broad, not "Diversified"). */
export function choosableSubSectors(index: TaxIndex): TaxNode[] {
  return Array.from(index.nodes.values()).filter((n) => n.dimension === "sector" && n.status === "active" && SECTOR_KINDS.includes(n.kind));
}

/** A name the founder used, as a node: a sub-sector first (label or synonym), then a sector (group). */
export function resolveSectorName(index: TaxIndex, name: string): TaxNode | null {
  const k = key(name);
  if (!k) return null;
  const subs = choosableSubSectors(index);
  const sub = subs.find((n) => key(n.label) === k) ?? subs.find((n) => n.synonyms.some((s) => key(s) === k));
  if (sub) return sub;
  return Array.from(index.nodes.values()).find((n) => n.dimension === "sector" && n.kind === "group" && n.status === "active" && key(n.label) === k) ?? null;
}

const isBroad = (n: TaxNode) => n.kind === "group" || n.attrs.granularity === "broad";

/** The sub-sectors under a sector (all of its sub-sectors) or under a broad sub-sector. */
export function optionsUnder(index: TaxIndex, node: TaxNode): TaxNode[] {
  const subs = choosableSubSectors(index);
  if (node.kind === "group") return subs.filter((n) => groupOf(index, n.id) === node.id);
  const under = covered(index, node.id);
  return subs.filter((n) => n.id !== node.id && under.has(n.id));
}

/**
 * Whether the founder's sector answer needs the picker: every name they gave
 * is a sector or a broad sub-sector (a specific one already settles it), and
 * there is something under it to pick.
 */
export function pickFor(index: TaxIndex, names: string[], at: string): SubSectorPick | null {
  const nodes = names.map((n) => resolveSectorName(index, n)).filter((n): n is TaxNode => !!n);
  if (!nodes.length || nodes.some((n) => !isBroad(n))) return null;
  const asked = Array.from(new Map(nodes.map((n) => [n.id, n])).values());
  const options = new Map<string, TaxNode>();
  asked.forEach((n) => optionsUnder(index, n).forEach((o) => options.set(o.id, o)));
  if (!options.size) return null;
  return {
    status: "open",
    asked: asked.map(option),
    options: Array.from(options.values()).sort((a, b) => Number(isBroad(a)) - Number(isBroad(b)) || a.label.localeCompare(b.label)).map(option),
    description: "",
    suggestions: [],
    chosen: [],
    at,
  };
}

/** The founder's chosen ids, kept only when they are on offer (the list or the AI's suggestions). */
export function cleanChoice(pick: SubSectorPick, ids: unknown): SubSectorOption[] {
  if (!Array.isArray(ids)) return [];
  const offered = new Map([...pick.options, ...pick.suggestions].map((o) => [o.id, { id: o.id, label: o.label }]));
  const out: SubSectorOption[] = [];
  for (const id of ids) {
    const o = typeof id === "string" ? offered.get(id) : undefined;
    if (o && !out.some((x) => x.id === o.id)) out.push(o);
  }
  return out.slice(0, SUB_SECTOR_LIMITS.pickMax);
}

/** The line added to the conversation, so Rupert and the profile build see the answer. */
export function pickMessage(pick: SubSectorPick): string {
  if (pick.status === "picked") return `From the list, my sub-sector${pick.chosen.length === 1 ? " is" : "s are, most important first:"} ${pick.chosen.map((c) => c.label).join(", ")}.`;
  return `None of the listed sub-sectors fits. In my own words: ${pick.description}`;
}

function asOptions(value: unknown, withWhy = false): SubSectorSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({ id: String(x.id ?? ""), label: String(x.label ?? ""), why: withWhy ? String(x.why ?? "") : "" }))
    .filter((x) => x.id && x.label);
}

export function asSubSectorPick(value: unknown): SubSectorPick | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const status = ["open", "describe", "suggested", "picked", "unmatched"].includes(String(v.status)) ? (v.status as SubSectorStatus) : null;
  if (!status) return null;
  const strip = (list: SubSectorSuggestion[]) => list.map(({ id, label }) => ({ id, label }));
  return {
    status,
    asked: strip(asOptions(v.asked)),
    options: strip(asOptions(v.options)),
    description: String(v.description ?? "").slice(0, SUB_SECTOR_LIMITS.descriptionMax),
    suggestions: asOptions(v.suggestions, true),
    chosen: strip(asOptions(v.chosen)),
    at: String(v.at ?? ""),
  };
}
