"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { loadLiveDb } from "@/lib/match/db-server";
import { createServiceClient } from "@/lib/supabase/admin";
import { proposeRelationships, proposeValueMappings } from "@/lib/taxonomy/ai-server";
import { isClaudeConfigured } from "@/lib/anthropic";
import {
  DIMENSIONS,
  FIELD_KEYS,
  RELATIONS,
  type Dimension,
  type FieldKey,
  type Relation,
} from "@/lib/taxonomy/core";
import { lookupFirmsIn, type LookupFirm } from "@/lib/taxonomy/lookup";
import {
  approveAlias,
  createEdges,
  createNode,
  loadTaxonomy,
  resolveProposal,
  reviewEdge,
  runCoverage,
  setAlias,
  updateNode,
} from "@/lib/taxonomy/server";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const PAGE_PATH = "/admin/taxonomy";

async function requireAdmin() {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") {
    return { ok: false as const, error: "You do not have permission to do that." };
  }
  if (!isServiceRoleConfigured()) {
    return { ok: false as const, error: "Service role key is not configured." };
  }
  return { ok: true as const, supabase: createServiceClient(), email: user.email ?? null };
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function asField(value: unknown): FieldKey | null {
  return FIELD_KEYS.includes(value as FieldKey) ? (value as FieldKey) : null;
}

function asRelation(value: unknown): Relation | null {
  return RELATIONS.includes(value as Relation) ? (value as Relation) : null;
}

function asText(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function done<T extends object>(value: T): Result<T> {
  revalidatePath(PAGE_PATH);
  return { ok: true, ...value };
}

/** AI suggestions in one Classify run stop here, leaving time to reply. */
const CLASSIFY_BUDGET_MS = 200_000;

/**
 * Classify new data: finds every provider value the taxonomy hasn't seen
 * (and recounts coverage), then asks the AI to suggest a category for every
 * unmapped value, field by field. Suggestions never apply on their own: each
 * waits under Value mappings for an admin to accept or reject it.
 */
export async function classifyNewData(): Promise<
  Result<{ registered: number; suggested: number; remaining: number; aiReady: boolean }>
> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  try {
    const run = await runCoverage(access.supabase, access.email);
    if (!run.ok) return run;
    if (!isClaudeConfigured()) {
      return done({ registered: run.value.registered, suggested: 0, remaining: 0, aiReady: false });
    }
    const deadline = Date.now() + CLASSIFY_BUDGET_MS;
    let suggested = 0;
    let remaining = 0;
    for (const field of FIELD_KEYS) {
      let left = 1;
      while (left > 0 && Date.now() < deadline) {
        const proposed = await proposeValueMappings(access.supabase, field, access.email);
        if (!proposed.ok) return proposed;
        suggested += proposed.value.proposed;
        left = proposed.value.remaining;
        if (proposed.value.proposed === 0) break;
      }
      remaining += left;
    }
    return done({ registered: run.value.registered, suggested, remaining, aiReady: true });
  } catch (err) {
    return { ok: false, error: errorText(err, "Classifying the new data failed.") };
  }
}

export async function mapValue(input: {
  field: string;
  rawKey: string;
  state: string;
  nodeIds: string[];
  rationale: string;
}): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const field = asField(input?.field);
  const state = input?.state === "mapped" || input?.state === "ignored" ? input.state : null;
  if (!field || !state) return { ok: false, error: "Unknown value." };
  const saved = await setAlias(
    access.supabase,
    {
      field,
      rawKey: asText(input.rawKey, 500),
      state,
      nodeIds: Array.isArray(input.nodeIds) ? input.nodeIds.map(String).slice(0, 20) : [],
      rationale: asText(input.rationale, 600),
    },
    access.email,
  );
  return saved.ok ? done({}) : saved;
}

export async function approveValue(field: string, key: string): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const clean = asField(field);
  if (!clean) return { ok: false, error: "Unknown value." };
  const saved = await approveAlias(access.supabase, clean, asText(key, 500), access.email);
  return saved.ok ? done({}) : saved;
}

export async function resolveValueSuggestion(field: string, key: string, accept: boolean): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const clean = asField(field);
  if (!clean) return { ok: false, error: "Unknown value." };
  const saved = await resolveProposal(access.supabase, clean, asText(key, 500), accept === true, access.email);
  return saved.ok ? done({}) : saved;
}

export async function suggestValueMappings(field: string): Promise<Result<{ proposed: number; remaining: number }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const clean = asField(field);
  if (!clean) return { ok: false, error: "Unknown field." };
  try {
    const proposed = await proposeValueMappings(access.supabase, clean, access.email);
    return proposed.ok ? done(proposed.value) : proposed;
  } catch (err) {
    return { ok: false, error: errorText(err, "Suggestions could not be made.") };
  }
}

export async function reviewRelationship(id: string, review: string, relation: string | null): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (review !== "approved" && review !== "rejected") return { ok: false, error: "Unknown review." };
  const saved = await reviewEdge(
    access.supabase,
    { id: asText(id, 64), review, relation: relation == null ? null : asRelation(relation) },
    access.email,
  );
  return saved.ok ? done({}) : saved;
}

export async function addRelationship(input: {
  fromId: string;
  toId: string;
  relation: string;
  directed: boolean;
  rationale: string;
  context: string;
}): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const relation = asRelation(input?.relation);
  if (!relation) return { ok: false, error: "Pick a relationship type." };
  const saved = await createEdges(
    access.supabase,
    [
      {
        fromId: asText(input.fromId, 120),
        toId: asText(input.toId, 120),
        relation,
        directed: input.directed === true,
        rationale: asText(input.rationale, 600),
        context: asText(input.context, 300),
      },
    ],
    { origin: "manual", review: "approved", source: "Added by an admin" },
    access.email,
  );
  return saved.ok ? done({}) : saved;
}

export async function suggestRelationships(nodeId: string): Promise<Result<{ proposed: number }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  try {
    const proposed = await proposeRelationships(access.supabase, asText(nodeId, 120), access.email);
    return proposed.ok ? done(proposed.value) : proposed;
  } catch (err) {
    return { ok: false, error: errorText(err, "Suggestions could not be made.") };
  }
}

export async function addCategory(input: {
  dimension: string;
  label: string;
  parentId: string | null;
  kind: string;
  description: string;
}): Promise<Result<{ id: string }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const dimension = DIMENSIONS.includes(input?.dimension as Dimension) ? (input.dimension as Dimension) : null;
  if (!dimension) return { ok: false, error: "Unknown dimension." };
  const created = await createNode(
    access.supabase,
    {
      dimension,
      label: asText(input.label, 120),
      parentId: input.parentId ? asText(input.parentId, 120) : null,
      kind: asText(input.kind, 40),
      description: asText(input.description, 600),
    },
    access.email,
  );
  return created.ok ? done(created.value) : created;
}

export async function editCategory(input: {
  id: string;
  label: string;
  description: string;
  status: string;
}): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const status = input?.status === "retired" ? "retired" : "active";
  const saved = await updateNode(
    access.supabase,
    {
      id: asText(input.id, 120),
      label: asText(input.label, 120),
      description: asText(input.description, 600),
      status,
    },
    access.email,
  );
  return saved.ok ? done({}) : saved;
}

/**
 * Firm lookup: by name or FirmID, and by classified sector, geography and
 * stage (a category includes everything inside it).
 */
export async function lookupFirms(input: {
  query: string;
  sector: string | null;
  geography: string | null;
  stage: string | null;
}): Promise<Result<{ firms: LookupFirm[]; more: boolean }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const query = asText(input?.query, 120).trim();
  const pick = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null);
  const filters = { query, sector: pick(input?.sector), geography: pick(input?.geography), stage: pick(input?.stage) };
  if (query.length < 2 && !filters.sector && !filters.geography && !filters.stage) {
    return { ok: false, error: "Type at least 2 characters, or pick a filter." };
  }
  const [live, taxonomy] = await Promise.all([loadLiveDb(access.supabase), loadTaxonomy(access.supabase)]);
  if (!live.ok) return { ok: false, error: live.error };
  if (!taxonomy.ok) return taxonomy;
  return { ok: true, ...lookupFirmsIn(live.value.db.firms, taxonomy.value, filters) };
}
