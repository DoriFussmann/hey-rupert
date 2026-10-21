"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { loadLiveDb } from "@/lib/match/db-server";
import { createServiceClient } from "@/lib/supabase/admin";
import { proposeRelationships, proposeValueMappings } from "@/lib/taxonomy/ai-server";
import {
  DIMENSIONS,
  FIELD_KEYS,
  RELATIONS,
  firmLookupView,
  rawKey,
  type Dimension,
  type FieldKey,
  type FirmLookupView,
  type Relation,
} from "@/lib/taxonomy/core";
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

/** Maps every firm of the live database and stores the coverage report. */
export async function recomputeCoverage(): Promise<Result<{ registered: number; revision: number }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  try {
    const run = await runCoverage(access.supabase, access.email);
    if (!run.ok) return run;
    return done({ registered: run.value.registered, revision: run.value.revision });
  } catch (err) {
    return { ok: false, error: errorText(err, "Coverage could not be computed.") };
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

const LOOKUP_MAX = 20;

/** Firms of the live database by exact FirmID or by name. */
export async function lookupFirms(query: string): Promise<Result<{ firms: FirmLookupView[]; more: boolean }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const text = asText(query, 120).trim();
  if (text.length < 2) return { ok: false, error: "Type at least 2 characters." };
  const [live, taxonomy] = await Promise.all([loadLiveDb(access.supabase), loadTaxonomy(access.supabase)]);
  if (!live.ok) return { ok: false, error: live.error };
  if (!taxonomy.ok) return taxonomy;
  const key = rawKey(text);
  const firms = live.value.db.firms;
  const exact = firms.filter((firm) => firm.id === text);
  const byName = firms.filter((firm) => firm.id !== text && rawKey(firm.name).includes(key));
  const found = [...exact, ...byName];
  return {
    ok: true,
    firms: found.slice(0, LOOKUP_MAX).map((firm) => firmLookupView(firm, taxonomy.value)),
    more: found.length > LOOKUP_MAX,
  };
}
