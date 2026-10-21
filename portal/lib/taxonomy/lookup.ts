// Firm lookup: firms by name or FirmID, filtered by their classified sector,
// geography and stage. Pure module.

import type { Firm } from "../match/engine/index.mjs";
import { firmLookupView, mapFirm, rawKey, type FirmLookupView, type TaxIndex } from "./core.ts";

export const LOOKUP_MAX = 20;

export type LookupFilters = {
  query: string;
  sector: string | null;
  geography: string | null;
  stage: string | null;
};

/** A sector link of one of the firm's approved sectors. */
export type FirmRelationship = { sector: string; relation: string; other: string; directed: boolean };

export type LookupFirm = FirmLookupView & { relationships: FirmRelationship[] };

/** True when `id` is `ancestor` or sits inside it (parents and extra regions, recursively). */
export function isWithin(index: TaxIndex, id: string, ancestor: string) {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    if (current === ancestor) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const node = index.nodes.get(current);
    if (!node) continue;
    if (node.parentId) queue.push(node.parentId);
    const memberOf = (node.attrs as { memberOf?: unknown }).memberOf;
    if (Array.isArray(memberOf)) queue.push(...memberOf.map(String));
  }
  return false;
}

/** The approved sector links of a firm's approved sectors, each once. */
export function relationshipsOf(index: TaxIndex, sectorIds: string[]): FirmRelationship[] {
  const label = (id: string) => index.nodes.get(id)?.label ?? id;
  const out: FirmRelationship[] = [];
  const seen = new Set<string>();
  for (const id of sectorIds) {
    for (const edge of index.edgesByNode.get(id) ?? []) {
      if (edge.review !== "approved") continue;
      const outward = edge.fromId === id;
      if (!outward && edge.directed) continue;
      const other = outward ? edge.toId : edge.fromId;
      const key = `${id}|${other}|${edge.relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ sector: label(id), relation: edge.relation, other: label(other), directed: edge.directed });
    }
  }
  return out;
}

/**
 * Firms whose name contains the query (or whose FirmID is the query), with
 * at least one approved category inside each chosen filter. The first
 * LOOKUP_MAX, exact FirmID first, then by name.
 */
export function lookupFirmsIn(firms: Firm[], index: TaxIndex, filters: LookupFilters): { firms: LookupFirm[]; more: boolean } {
  const text = filters.query.trim();
  const key = text ? rawKey(text) : "";
  const wanted = [filters.sector, filters.geography, filters.stage].filter((id): id is string => Boolean(id));
  const found: Firm[] = [];
  let more = false;
  const candidates = [...firms].sort((a, b) => (a.id === text ? -1 : b.id === text ? 1 : a.name.localeCompare(b.name)));
  for (const firm of candidates) {
    if (key && firm.id !== text && !rawKey(firm.name).includes(key)) continue;
    if (wanted.length) {
      const tags = mapFirm(firm, index).tags.filter((tag) => tag.review === "approved");
      if (!wanted.every((id) => tags.some((tag) => isWithin(index, tag.nodeId, id)))) continue;
    }
    if (found.length === LOOKUP_MAX) {
      more = true;
      break;
    }
    found.push(firm);
  }
  return {
    firms: found.map((firm) => {
      const view = firmLookupView(firm, index);
      const sectors = view.fields
        .filter((field) => field.field === "industry" || field.field === "vertical")
        .flatMap((field) => field.tags.filter((tag) => tag.review === "approved").map((tag) => tag.nodeId));
      return { ...view, relationships: relationshipsOf(index, Array.from(new Set(sectors))) };
    }),
    more,
  };
}
