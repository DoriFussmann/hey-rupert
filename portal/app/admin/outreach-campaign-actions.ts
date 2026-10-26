"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isClaudeConfigured } from "@/lib/anthropic";
import { isServiceRoleConfigured } from "@/lib/env";
import {
  buildCampaign,
  draftWarmIntroBlurb,
  loadCampaignState,
  saveWarmIntroBlurb,
  setOverride,
  type CampaignState,
} from "@/lib/outreach/campaign-server";
import { createServiceClient } from "@/lib/supabase/admin";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireAdmin(clientId: string) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  if (!UUID.test(String(clientId))) return { ok: false as const, error: "Unknown client." };
  return { ok: true as const, supabase: createServiceClient(), actor: user.email ?? null };
}

async function stateResult(clientId: string, supabase: ReturnType<typeof createServiceClient>): Promise<Result<{ state: CampaignState }>> {
  const loaded = await loadCampaignState(supabase, clientId);
  return loaded.ok ? { ok: true, state: loaded.value } : loaded;
}

export async function loadCampaignAction(clientId: string): Promise<Result<{ state: CampaignState }>> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  return stateResult(clientId, access.supabase);
}

export async function buildCampaignAction(clientId: string): Promise<Result<{ state: CampaignState; contacts: number; unwritten: string[] }>> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  try {
    const built = await buildCampaign(access.supabase, clientId, access.actor);
    if (!built.ok) return built;
    const state = await stateResult(clientId, access.supabase);
    if (!state.ok) return state;
    return { ok: true, state: state.state, contacts: built.value.contacts, unwritten: built.value.unwritten };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unable to build the campaign." };
  }
}

/** Puts a fund the client knows back into the campaign, or takes it out again. */
export async function overrideKnownAction(clientId: string, firmId: string, on: boolean): Promise<Result<{ state: CampaignState }>> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const saved = await setOverride(access.supabase, clientId, String(firmId).slice(0, 200), Boolean(on), access.actor);
  if (!saved.ok) return saved;
  revalidatePath("/portal/setup/warm-intros");
  return stateResult(clientId, access.supabase);
}

export async function saveBlurbAction(clientId: string, ask: string, blurb: string): Promise<Result<{ ask: string; blurb: string }>> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const saved = await saveWarmIntroBlurb(access.supabase, clientId, ask, blurb);
  if (!saved.ok) return saved;
  revalidatePath("/portal/setup/warm-intros");
  return { ok: true, ...saved.value };
}

export async function draftBlurbAction(clientId: string): Promise<Result<{ ask: string; blurb: string }>> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  if (!isClaudeConfigured()) return { ok: false, error: "Claude is not configured (ANTHROPIC_API_KEY)." };
  const drafted = await draftWarmIntroBlurb(access.supabase, clientId);
  if (!drafted.ok) return drafted;
  revalidatePath("/portal/setup/warm-intros");
  return { ok: true, ...drafted.value };
}
