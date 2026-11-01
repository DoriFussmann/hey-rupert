"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { loadTaxonomy } from "@/lib/taxonomy/server";
import { editAddedFund, labelLists, listAddedFunds, reviewAddedFund, type AddedEdits, type LabelLists } from "@/lib/match/added/server";
import type { AddedFund, AddedStatus } from "@/lib/match/added/core";

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
