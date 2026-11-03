"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { loadTaxonomy } from "@/lib/taxonomy/server";
import { dismissSuggestion, skipMissingFields, editAddedFund, fillAddedFields, fillItems, labelLists, listAddedFunds, reviewAddedFund, suggestMissingFields, type AddedEdits, type LabelLists } from "@/lib/match/added/server";
import type { AddedFund, AddedStatus, FillItem } from "@/lib/match/added/core";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function access() {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  return { ok: true as const, supabase: createServiceClient(), email: user.email ?? null };
}

const validId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id);

export type AddedView = AddedFund & { clientName: string | null };

/** Every fund added by Rupert (pending first), the client each was found for, and the taxonomy labels for editing. */
export async function loadAddedFunds(): Promise<Result<{ funds: AddedView[]; labels: LabelLists }>> {
  const a = await access();
  if (!a.ok) return a;
  const [funds, taxonomy] = await Promise.all([listAddedFunds(a.supabase), loadTaxonomy(a.supabase)]);
  if (!funds.ok) return { ok: false, error: funds.error };
  if (!taxonomy.ok) return { ok: false, error: taxonomy.error };
  const clientIds = Array.from(new Set(funds.value.map((f) => f.foundForClient).filter((id): id is string => !!id)));
  const names = new Map<string, string>();
  if (clientIds.length) {
    const { data } = await a.supabase.from("clients").select("id, company_name").in("id", clientIds);
    for (const c of (data ?? []) as { id: string; company_name: string }[]) names.set(c.id, c.company_name);
  }
  const order: Record<AddedStatus, number> = { pending: 0, approved: 1, rejected: 2 };
  const view = funds.value
    .map((f) => ({ ...f, clientName: f.foundForClient ? names.get(f.foundForClient) ?? null : null }))
    .sort((x, y) => order[x.status] - order[y.status] || y.createdAt.localeCompare(x.createdAt));
  return { ok: true, funds: view, labels: labelLists(taxonomy.value) };
}

/** Edits a pending fund's details. Labels outside the taxonomy are dropped. */
export async function editAdded(id: string, edits: AddedEdits): Promise<Result<{ fund: AddedFund }>> {
  const a = await access();
  if (!a.ok) return a;
  if (!validId(id)) return { ok: false, error: "Unknown fund." };
  const taxonomy = await loadTaxonomy(a.supabase);
  if (!taxonomy.ok) return { ok: false, error: taxonomy.error };
  const done = await editAddedFund(a.supabase, taxonomy.value, id, edits ?? {});
  return done.ok ? { ok: true, fund: done.value } : { ok: false, error: done.error };
}

/** Approve (joins the shared database for every client), reject, or back to pending. */
export async function reviewAdded(id: string, status: AddedStatus, note: string): Promise<Result<{ fund: AddedFund }>> {
  const a = await access();
  if (!a.ok) return a;
  if (!validId(id)) return { ok: false, error: "Unknown fund." };
  if (!["pending", "approved", "rejected"].includes(status)) return { ok: false, error: "Unknown status." };
  const done = await reviewAddedFund(a.supabase, id, status, typeof note === "string" ? note : "", a.email);
  if (!done.ok) return { ok: false, error: done.error };
  revalidatePath("/admin/fund-database");
  return { ok: true, fund: done.value };
}

/** The added investors (pending or approved, any client) still missing a stage, geography or sector, and the labels to choose from. */
export async function loadMissingFields(): Promise<Result<{ items: FillItem[]; options: { stages: string[]; geographies: string[]; sectors: string[] } }>> {
  const a = await access();
  if (!a.ok) return a;
  const [funds, taxonomy] = await Promise.all([listAddedFunds(a.supabase), loadTaxonomy(a.supabase)]);
  if (!funds.ok) return { ok: false, error: funds.error };
  if (!taxonomy.ok) return { ok: false, error: taxonomy.error };
  const labels = labelLists(taxonomy.value);
  return {
    ok: true,
    items: fillItems(taxonomy.value, funds.value),
    options: { stages: labels.stages, geographies: labels.geographies, sectors: [...labels.industries, ...labels.verticals].sort() },
  };
}

/** Fill missing fields with AI, for a few investors at once: suggestions only, waiting for Accept. */
export async function suggestAddedFields(ids: unknown): Promise<Result<{ problems: string[] }>> {
  const a = await access();
  if (!a.ok) return a;
  const list = Array.isArray(ids) ? ids.filter(validId).slice(0, 8) : [];
  const taxonomy = await loadTaxonomy(a.supabase);
  if (!taxonomy.ok) return { ok: false, error: taxonomy.error };
  const results = await Promise.all(list.map((id) => suggestMissingFields(a.supabase, taxonomy.value, id, null)));
  return { ok: true, problems: results.filter((r): r is { ok: false; error: string } => !r.ok).map((r) => r.error) };
}

/** Saves (or accepts the AI's suggestion for) an added investor's missing fields. */
export async function fillAdded(id: string, fields: { stages?: string[]; geographies?: string[]; sectors?: string[] }): Promise<Result<object>> {
  const a = await access();
  if (!a.ok) return a;
  if (!validId(id)) return { ok: false, error: "Unknown fund." };
  const taxonomy = await loadTaxonomy(a.supabase);
  if (!taxonomy.ok) return { ok: false, error: taxonomy.error };
  const clean = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 50) : undefined);
  const done = await fillAddedFields(a.supabase, taxonomy.value, null, id, { stages: clean(fields?.stages), geographies: clean(fields?.geographies), sectors: clean(fields?.sectors) });
  return done.ok ? { ok: true } : { ok: false, error: done.error };
}

export async function dismissAddedSuggestion(id: string): Promise<Result<object>> {
  const a = await access();
  if (!a.ok) return a;
  if (!validId(id)) return { ok: false, error: "Unknown fund." };
  const done = await dismissSuggestion(a.supabase, id);
  return done.ok ? { ok: true } : { ok: false, error: done.error };
}

export async function skipAddedFields(id: string, skip: boolean): Promise<Result<object>> {
  const a = await access();
  if (!a.ok) return a;
  if (!validId(id)) return { ok: false, error: "Unknown fund." };
  const done = await skipMissingFields(a.supabase, id, skip === true);
  return done.ok ? { ok: true } : { ok: false, error: done.error };
}
