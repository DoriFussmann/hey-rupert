"use server";

import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { isClaudeConfigured } from "@/lib/anthropic";
import { createServiceClient } from "@/lib/supabase/admin";
import { loadTaxonomy } from "@/lib/taxonomy/server";
import { lockedError } from "@/lib/match/summary/server";
import type { AddedFund } from "@/lib/match/added/core";
import {
  addManualFund,
  findManualEmails,
  manualFunds,
  manualOptions,
  removeManualFund,
  researchManualFund,
  updateManualFund,
  type ManualFundInput,
  type ManualOptions,
} from "@/lib/match/added/manual";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function access(clientId: unknown, change = true) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  if (typeof clientId !== "string" || !/^[0-9a-f-]{36}$/i.test(clientId)) return { ok: false as const, error: "Unknown client." };
  const supabase = createServiceClient();
  if (change) {
    const locked = await lockedError(supabase, clientId);
    if (locked) return { ok: false as const, error: locked };
  }
  return { ok: true as const, supabase, email: user.email ?? null, clientId };
}

const fail = (err: unknown, fallback: string) => ({ ok: false as const, error: err instanceof Error ? err.message : fallback });
const isId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id);

/** The funds added by hand for this client, and the taxonomy's labels for the form. */
export async function loadManualFunds(clientId: string): Promise<Result<{ funds: AddedFund[]; options: ManualOptions; hunter: boolean; claude: boolean }>> {
  const a = await access(clientId, false);
  if (!a.ok) return a;
  try {
    const taxonomy = await loadTaxonomy(a.supabase);
    if (!taxonomy.ok) return { ok: false, error: taxonomy.error };
    return {
      ok: true,
      funds: await manualFunds(a.supabase, a.clientId),
      options: manualOptions(taxonomy.value),
      hunter: Boolean(process.env.HUNTER_API_KEY),
      claude: isClaudeConfigured(),
    };
  } catch (err) {
    return fail(err, "The added funds did not load.");
  }
}

/** Adds a fund (new) or saves it (with an id). */
export async function saveManualFund(clientId: string, id: string | null, input: ManualFundInput): Promise<Result<{ fund: AddedFund }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    const taxonomy = await loadTaxonomy(a.supabase);
    if (!taxonomy.ok) return { ok: false, error: taxonomy.error };
    const done = id
      ? isId(id)
        ? await updateManualFund(a.supabase, taxonomy.value, a.clientId, id, input)
        : ({ ok: false, error: "Unknown fund." } as const)
      : await addManualFund(a.supabase, taxonomy.value, a.clientId, input, a.email);
    return done.ok ? { ok: true, fund: done.value } : { ok: false, error: done.error };
  } catch (err) {
    return fail(err, "The fund was not saved.");
  }
}

export async function deleteManualFund(clientId: string, id: string): Promise<Result<object>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  if (!isId(id)) return { ok: false, error: "Unknown fund." };
  try {
    const done = await removeManualFund(a.supabase, a.clientId, id, a.email);
    return done.ok ? { ok: true } : { ok: false, error: done.error };
  } catch (err) {
    return fail(err, "The fund was not removed.");
  }
}

/** Hunter: emails for the contacts without one, or the team at the fund's domain. */
export async function huntManualEmails(clientId: string, id: string): Promise<Result<{ fund: AddedFund; message: string }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  if (!isId(id)) return { ok: false, error: "Unknown fund." };
  try {
    const done = await findManualEmails(a.supabase, a.clientId, id);
    return done.ok ? { ok: true, ...done.value } : { ok: false, error: done.error };
  } catch (err) {
    return fail(err, "Hunter did not finish.");
  }
}

/** Fill with AI: suggestions for the form (nothing is saved). */
export async function fillManualFund(
  clientId: string,
  input: { name: string; kind: "fund" | "angel"; website: string },
): Promise<Result<{ fill: Partial<ManualFundInput> }>> {
  const a = await access(clientId, false);
  if (!a.ok) return a;
  if (!isClaudeConfigured()) return { ok: false, error: "ANTHROPIC_API_KEY is not configured." };
  try {
    const taxonomy = await loadTaxonomy(a.supabase);
    if (!taxonomy.ok) return { ok: false, error: taxonomy.error };
    const done = await researchManualFund(a.supabase, taxonomy.value, a.clientId, input);
    return done.ok ? { ok: true, fill: done.value } : { ok: false, error: done.error };
  } catch (err) {
    return fail(err, "The research did not finish.");
  }
}
