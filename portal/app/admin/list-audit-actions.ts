"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isClaudeConfigured } from "@/lib/anthropic";
import { isServiceRoleConfigured } from "@/lib/env";
import { removeFromPlanAction } from "@/app/admin/capacity-actions";
import { pushRunToClient } from "@/app/admin/match-actions";
import {
  AUDIT_BATCH,
  auditSample,
  listFingerprint,
  remainingFunds,
  type AuditDecision,
  type ListAudit,
} from "@/lib/list-audit";
import { createAudit, loadAudit, reviewFunds, saveAudit, summarizeAudit } from "@/lib/list-audit-server";
import { asInvestorList, asInvestorListDraft, type InvestorListPayload } from "@/lib/setup";
import { loadSetupStep } from "@/lib/setup-server";
import { createServiceClient } from "@/lib/supabase/admin";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;
const CHANGED = "The list changed since this audit started. Run the audit again.";

async function requireAdmin(withClaude: boolean) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  if (withClaude && !isClaudeConfigured()) return { ok: false as const, error: "ANTHROPIC_API_KEY is not configured." };
  return { ok: true as const, supabase: createServiceClient(), actor: user.email ?? null };
}

/** The list the panel shows: Rupert's draft, or what the client has when there is no draft. */
async function currentList(supabase: ReturnType<typeof createServiceClient>, clientId: string) {
  const loaded = await loadSetupStep(supabase, clientId, "investor_list");
  if (!loaded.ok) return loaded;
  const draft = asInvestorListDraft(loaded.row?.draft);
  const list: InvestorListPayload = draft.rows.length > 0 ? draft : asInvestorList(loaded.row?.published);
  if (list.rows.length === 0) return { ok: false as const, error: "No list yet. Push the list from Matching first." };
  return { ok: true as const, list };
}

function revalidateClient(clientId: string) {
  revalidatePath(`/admin/clients/${clientId}`);
}

/** Starts an audit of the list as it is now: the first funds in each tier. */
export async function startListAudit(clientId: string): Promise<Result<{ audit: ListAudit }>> {
  const access = await requireAdmin(true);
  if (!access.ok) return access;
  if (!UUID.test(String(clientId ?? ""))) return { ok: false, error: "Unknown client." };
  const current = await currentList(access.supabase, clientId);
  if (!current.ok) return current;
  const sample = auditSample(current.list.rows);
  if (sample.length === 0) return { ok: false, error: "The list has no funds the client would see." };
  const created = await createAudit(access.supabase, {
    clientId,
    fingerprint: listFingerprint(current.list.rows),
    runId: current.list.run_id ?? null,
    sample,
    actor: access.actor,
  });
  if (!created.ok) return created;
  revalidateClient(clientId);
  return { ok: true, audit: created.value };
}

/** Reviews the next few funds of a running audit (one request each, so the page shows progress). */
export async function auditNextFunds(clientId: string, auditId: string): Promise<Result<{ audit: ListAudit }>> {
  const access = await requireAdmin(true);
  if (!access.ok) return access;
  if (!UUID.test(String(clientId ?? "")) || !UUID.test(String(auditId ?? ""))) return { ok: false, error: "Unknown audit." };
  const [loaded, current] = await Promise.all([loadAudit(access.supabase, clientId, auditId), currentList(access.supabase, clientId)]);
  if (!loaded.ok) return loaded;
  if (!current.ok) return current;
  const audit = loaded.value;
  if (audit.list_fingerprint !== listFingerprint(current.list.rows)) return { ok: false, error: CHANGED };
  const next = remainingFunds(audit).slice(0, AUDIT_BATCH);
  if (next.length === 0) return { ok: true, audit };
  const reviewed = await reviewFunds(access.supabase, clientId, current.list, next);
  if (!reviewed.ok) return reviewed;
  const saved = await saveAudit(access.supabase, audit, { funds: [...audit.funds, ...reviewed.value] });
  if (!saved.ok) return saved;
  return { ok: true, audit: saved.value };
}

/** Writes the founder's overall read once every fund is reviewed, and completes the audit. */
export async function finishListAudit(clientId: string, auditId: string): Promise<Result<{ audit: ListAudit }>> {
  const access = await requireAdmin(true);
  if (!access.ok) return access;
  if (!UUID.test(String(clientId ?? "")) || !UUID.test(String(auditId ?? ""))) return { ok: false, error: "Unknown audit." };
  const [loaded, current] = await Promise.all([loadAudit(access.supabase, clientId, auditId), currentList(access.supabase, clientId)]);
  if (!loaded.ok) return loaded;
  if (!current.ok) return current;
  const audit = loaded.value;
  if (audit.list_fingerprint !== listFingerprint(current.list.rows)) return { ok: false, error: CHANGED };
  if (remainingFunds(audit).length > 0) return { ok: false, error: "Some funds are not reviewed yet." };
  const summary = await summarizeAudit(access.supabase, clientId, current.list, audit.funds);
  if (!summary.ok) return summary;
  const saved = await saveAudit(access.supabase, audit, { summary: summary.value, status: "complete" });
  if (!saved.ok) return saved;
  revalidateClient(clientId);
  return { ok: true, audit: saved.value };
}

/**
 * Records the admin's decision on a flagged fund. Remove takes the fund out
 * of the confirmed campaign plan (the next fund in its tier moves in); the
 * draft changes when the list is pushed from the plan again.
 */
export async function decideAuditFund(
  clientId: string,
  auditId: string,
  fundId: string,
  decision: AuditDecision,
): Promise<Result<{ audit: ListAudit; replacedBy: string | null }>> {
  const access = await requireAdmin(false);
  if (!access.ok) return access;
  if (!UUID.test(String(clientId ?? "")) || !UUID.test(String(auditId ?? ""))) return { ok: false, error: "Unknown audit." };
  if (decision !== "keep" && decision !== "remove") return { ok: false, error: "Unknown decision." };
  const loaded = await loadAudit(access.supabase, clientId, auditId);
  if (!loaded.ok) return loaded;
  const audit = loaded.value;
  const fund = audit.funds.find((item) => item.id === fundId);
  if (!fund) return { ok: false, error: "That fund is not in this audit." };
  if (fund.decision === "remove") return { ok: false, error: "This fund was already removed from the campaign." };

  let replacedBy: string | null = null;
  if (decision === "remove") {
    if (!audit.run_id) return { ok: false, error: "This list has no saved run. Remove the fund in Matching." };
    const removed = await removeFromPlanAction(clientId, audit.run_id, fund.id, `List audit: ${fund.reason}`.slice(0, 500));
    if (!removed.ok) return removed;
    replacedBy = removed.replacedBy;
  }
  const at = new Date().toISOString();
  const saved = await saveAudit(access.supabase, audit, {
    funds: audit.funds.map((item) => (item.id === fund.id ? { ...item, decision, decided_at: at } : item)),
  });
  if (!saved.ok) return saved;
  return { ok: true, audit: saved.value, replacedBy };
}

/** Puts the confirmed plan (after removals) on the draft again, as Push to client on Matching does. */
export async function refreshDraftFromPlan(clientId: string): Promise<Result<{ funds: number }>> {
  const access = await requireAdmin(false);
  if (!access.ok) return access;
  if (!UUID.test(String(clientId ?? ""))) return { ok: false, error: "Unknown client." };
  const current = await currentList(access.supabase, clientId);
  if (!current.ok) return current;
  if (!current.list.run_id) return { ok: false, error: "This list has no saved run. Push it again from Matching." };
  const pushed = await pushRunToClient(clientId, current.list.run_id);
  if (!pushed.ok) return pushed;
  revalidateClient(clientId);
  return { ok: true, funds: pushed.funds };
}
