"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isClaudeConfigured } from "@/lib/anthropic";
import { isServiceRoleConfigured } from "@/lib/env";
import { asIntakeInterview } from "@/lib/intake-server";
import {
  FUND_UPLOAD_FOLDER,
  asFundDbVersion,
  buildFundDb,
  diffFundDb,
  loadLiveDb,
  matchTableError,
  newVersionPaths,
  selectAll,
  snapshotBytes,
} from "@/lib/match/db-server";
import {
  cleanAnswers,
  cleanSettings,
  extractAnswers,
  loadProfileState,
  saveProfileState,
} from "@/lib/match/profile-server";
import {
  buildClientList,
  buildDetail,
  buildView,
  runClientMatch,
  siteCandidates,
  storeMatch,
} from "@/lib/match/run-server";
import { checkAndStoreSites, isStale, runSiteBatch } from "@/lib/match/sites-server";
import {
  DEFAULT_SETTINGS,
  FUND_DB_BUCKET,
  FUND_DB_MAX_BYTES,
  FUND_UPLOAD_CHUNK_BYTES,
  REJECT_REASONS,
  type FirmDetail,
  type FundDbVersion,
  type MatchProfileState,
  type MatchView,
  type Tier,
} from "@/lib/match/shared";
import { notifyClient } from "@/lib/notify";
import { INVESTOR_LIST_BLOCKED, asInvestorList, canPublish } from "@/lib/setup";
import { loadSetupSteps, nowIso, setupTableError } from "@/lib/setup-server";
import { createServiceClient } from "@/lib/supabase/admin";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Website checks inside a request stop here, leaving time to save and reply. */
const SITE_BUDGET_MS = 200_000;

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

function revalidateMatch(clientId: string) {
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath(`/admin/clients/${clientId}/match`);
  revalidatePath(`/admin/clients/${clientId}/profile`);
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

// ---------------------------------------------------------------------------
// Fund database

export async function createFundUpload(file: {
  name: string;
  size: number;
}): Promise<Result<{ path: string }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const name = String(file?.name ?? "");
  const size = Number(file?.size ?? 0);
  if (!/\.xlsx$/i.test(name)) {
    return { ok: false, error: "Upload the workbook as an .xlsx file." };
  }
  if (!(size > 0) || size > FUND_DB_MAX_BYTES) {
    return { ok: false, error: "The file must be under 50 MB." };
  }
  return { ok: true, path: `${FUND_UPLOAD_FOLDER}${randomUUID()}.xlsx` };
}

const UPLOAD_PATH = /^uploads\/[0-9a-f-]{36}\.xlsx$/;
const MAX_PARTS = Math.ceil(FUND_DB_MAX_BYTES / FUND_UPLOAD_CHUNK_BYTES);

function partPath(path: string, index: number) {
  return `${path}.parts/${String(index).padStart(4, "0")}`;
}

/**
 * Stores one piece of the workbook. The browser sends the file in pieces
 * through the website (each under the hosting request limit), so it never
 * talks to storage directly.
 */
export async function uploadFundChunk(form: FormData): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const path = String(form.get("path") ?? "");
  const index = Number(form.get("index"));
  const chunk = form.get("chunk");
  if (!UPLOAD_PATH.test(path) || !Number.isInteger(index) || index < 0 || index >= MAX_PARTS) {
    return { ok: false, error: "Unknown upload." };
  }
  if (!(chunk instanceof Blob) || chunk.size === 0 || chunk.size > FUND_UPLOAD_CHUNK_BYTES) {
    return { ok: false, error: "Upload piece is missing or too large." };
  }
  const { error } = await access.supabase.storage
    .from(FUND_DB_BUCKET)
    .upload(partPath(path, index), Buffer.from(await chunk.arrayBuffer()), {
      contentType: "application/octet-stream",
      upsert: true,
    });
  if (error) {
    return { ok: false, error: matchTableError(`Upload failed: ${error.message}.`) };
  }
  return { ok: true };
}

async function removeStaged(supabase: ReturnType<typeof createServiceClient>) {
  const { data } = await supabase
    .from("fund_db_versions")
    .select("id, upload_path, snapshot_path")
    .eq("status", "staged");
  for (const row of data ?? []) {
    await supabase.storage
      .from(FUND_DB_BUCKET)
      .remove([String(row.upload_path), String(row.snapshot_path)]);
    await supabase.from("fund_db_versions").delete().eq("id", row.id).eq("status", "staged");
  }
}

/** Reads the uploaded workbook and prepares it as a staged version. */
export async function stageFundUpload(
  path: string,
  fileName: string,
  parts: number,
): Promise<Result<{ version: FundDbVersion }> & { errors?: string[] }> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const supabase = access.supabase;
  const cleanPath = String(path ?? "");
  const count = Number(parts);
  if (!UPLOAD_PATH.test(cleanPath) || !Number.isInteger(count) || count < 1 || count > MAX_PARTS) {
    return { ok: false, error: "Unknown upload." };
  }
  const pieces = Array.from({ length: count }, (_, index) => partPath(cleanPath, index));
  const removePieces = () => supabase.storage.from(FUND_DB_BUCKET).remove(pieces);
  const discardUpload = () => supabase.storage.from(FUND_DB_BUCKET).remove([cleanPath, ...pieces]);

  try {
    // Join the pieces back into the workbook and keep it as one file.
    const buffers: Buffer[] = [];
    for (const piece of pieces) {
      const { data, error } = await supabase.storage.from(FUND_DB_BUCKET).download(piece);
      if (error || !data) {
        await discardUpload();
        return { ok: false, error: `The upload is incomplete: ${error?.message ?? "missing piece"}. Upload again.` };
      }
      buffers.push(Buffer.from(await data.arrayBuffer()));
    }
    const workbook = Buffer.concat(buffers);
    if (workbook.length > FUND_DB_MAX_BYTES) {
      await discardUpload();
      return { ok: false, error: "The file must be under 50 MB." };
    }
    const { error: saveError } = await supabase.storage
      .from(FUND_DB_BUCKET)
      .upload(cleanPath, workbook, {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: true,
      });
    if (saveError) {
      await discardUpload();
      return { ok: false, error: `The upload could not be saved: ${saveError.message}.` };
    }
    await removePieces();

    const built = await buildFundDb(workbook);
    if (!built.ok) {
      await discardUpload();
      return { ok: false, error: "The workbook was not imported.", errors: built.errors };
    }

    const live = await loadLiveDb(supabase);
    if (!live.ok && !live.empty) {
      await discardUpload();
      return { ok: false, error: live.error };
    }

    const [reviewed, hidden] = await Promise.all([
      selectAll<{ firm_id: string }>((from, to) =>
        supabase.from("match_reviews").select("firm_id").order("firm_id").range(from, to),
      ),
      selectAll<{ firm_id: string }>((from, to) =>
        supabase.from("match_suppressions").select("firm_id").order("firm_id").range(from, to),
      ),
    ]);
    if (!reviewed.ok) return reviewed;
    if (!hidden.ok) return hidden;
    const reviewedIds = new Set([
      ...reviewed.rows.map((row) => row.firm_id),
      ...hidden.rows.map((row) => row.firm_id),
    ]);

    const { db, offices, warnings } = built.value;
    const diff = diffFundDb(live.ok ? live.value.db : null, db, reviewedIds, warnings);

    await removeStaged(supabase);
    const { id, snapshotPath } = newVersionPaths();
    const { error: uploadError } = await supabase.storage
      .from(FUND_DB_BUCKET)
      .upload(snapshotPath, snapshotBytes(db), { contentType: "application/gzip", upsert: false });
    if (uploadError) {
      return { ok: false, error: `The database could not be stored: ${uploadError.message}.` };
    }

    const { data: row, error } = await supabase
      .from("fund_db_versions")
      .insert({
        id,
        file_name: String(fileName ?? "").slice(0, 255) || "workbook.xlsx",
        upload_path: cleanPath,
        snapshot_path: snapshotPath,
        status: "staged",
        firms: db.firms.length,
        contacts: db.contacts.length,
        offices,
        diff,
        created_by: access.email,
      })
      .select("*")
      .single();
    if (error || !row) {
      await supabase.storage.from(FUND_DB_BUCKET).remove([snapshotPath]);
      return { ok: false, error: matchTableError(error?.message ?? "The version was not saved.", error?.code) };
    }

    revalidatePath("/admin/fund-database");
    return { ok: true, version: asFundDbVersion(row) };
  } catch (err) {
    return { ok: false, error: errorText(err, "The workbook could not be imported.") };
  }
}

/** Makes a staged or earlier version the live database. */
export async function applyFundVersion(id: string): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const { error } = await access.supabase.rpc("apply_fund_db_version", { p_id: String(id) });
  if (error) return { ok: false, error: matchTableError(error.message, error.code) };
  revalidatePath("/admin/fund-database");
  return { ok: true };
}

export async function discardFundVersion(id: string): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const { data, error } = await access.supabase
    .from("fund_db_versions")
    .select("id, status, upload_path, snapshot_path")
    .eq("id", String(id))
    .maybeSingle();
  if (error) return { ok: false, error: matchTableError(error.message, error.code) };
  if (!data || data.status !== "staged") {
    return { ok: false, error: "Only an upload that hasn't been applied can be discarded." };
  }
  await access.supabase.storage
    .from(FUND_DB_BUCKET)
    .remove([String(data.upload_path), String(data.snapshot_path)]);
  const { error: deleteError } = await access.supabase
    .from("fund_db_versions")
    .delete()
    .eq("id", data.id)
    .eq("status", "staged");
  if (deleteError) return { ok: false, error: matchTableError(deleteError.message, deleteError.code) };
  revalidatePath("/admin/fund-database");
  return { ok: true };
}

/** Runs the daily website batch now. */
export async function runWebsiteBatchNow(): Promise<
  Result<{ checked: number; summary: Record<string, number> }>
> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const result = await runSiteBatch(access.supabase, SITE_BUDGET_MS);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/admin/fund-database");
  return { ok: true, checked: result.checked, summary: result.summary };
}

// ---------------------------------------------------------------------------
// Match profile

/** Builds (or rebuilds) the company profile from the client's intake. */
export async function buildMatchProfile(
  clientId: string,
): Promise<Result<{ state: MatchProfileState }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (!isClaudeConfigured()) {
    return { ok: false, error: "ANTHROPIC_API_KEY is not configured." };
  }
  const supabase = access.supabase;
  const [{ data: client, error: clientError }, { data: interviewRow, error: interviewError }, current] =
    await Promise.all([
      supabase.from("clients").select("*").eq("id", clientId).maybeSingle(),
      supabase.from("intake_interviews").select("*").eq("client_id", clientId).maybeSingle(),
      loadProfileState(supabase, clientId),
    ]);
  if (clientError) return { ok: false, error: clientError.message };
  if (!client) return { ok: false, error: "Client not found." };
  if (interviewError) return { ok: false, error: interviewError.message };
  if (!current.ok) return current;
  const interview = interviewRow ? asIntakeInterview(interviewRow) : null;
  if (!interview || interview.messages.length === 0) {
    return { ok: false, error: "There is no intake interview to build from yet." };
  }

  const extracted = await extractAnswers(supabase, client as Record<string, unknown>, interview);
  if (!extracted.ok) return extracted;

  const saved = await saveProfileState(supabase, clientId, {
    answers: extracted.answers,
    settings: current.value?.settings ?? DEFAULT_SETTINGS,
    source: "intake",
    sourceInterviewAt: interview.updated_at,
  });
  if (!saved.ok) return saved;
  revalidateMatch(clientId);
  return { ok: true, state: saved.value };
}

async function viewFor(
  supabase: ReturnType<typeof createServiceClient>,
  clientId: string,
): Promise<{ view: MatchView | null; error: string | null }> {
  const run = await runClientMatch(supabase, clientId);
  if (!run.ok) return { view: null, error: run.error };
  const view = buildView(run.value);
  await storeMatch(supabase, clientId, view);
  return { view, error: null };
}

/** Saves the company profile as edited. Rupert Match re-runs on its next open. */
export async function saveCompanyProfile(
  clientId: string,
  answers: unknown,
): Promise<Result<{ state: MatchProfileState }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const current = await loadProfileState(access.supabase, clientId);
  if (!current.ok) return current;
  const saved = await saveProfileState(access.supabase, clientId, {
    answers: cleanAnswers(answers),
    settings: current.value?.settings ?? DEFAULT_SETTINGS,
    source: "edit",
  });
  if (!saved.ok) return saved;
  revalidateMatch(clientId);
  return { ok: true, state: saved.value };
}

/** Saves the operator settings (tightness, filters, rules) and re-runs. */
export async function updateMatchSettings(
  clientId: string,
  settings: unknown,
): Promise<Result<{ view: MatchView }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const current = await loadProfileState(access.supabase, clientId);
  if (!current.ok) return current;
  if (!current.value) return { ok: false, error: "Fill the company profile first." };
  const saved = await saveProfileState(access.supabase, clientId, {
    answers: current.value.answers,
    settings: cleanSettings(settings),
    source: "settings",
  });
  if (!saved.ok) return saved;
  const { view, error } = await viewFor(access.supabase, clientId);
  if (!view) return { ok: false, error: error ?? "The match could not run." };
  return { ok: true, view };
}

export async function runMatch(clientId: string): Promise<Result<{ view: MatchView }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const { view, error } = await viewFor(access.supabase, clientId);
  if (!view) return { ok: false, error: error ?? "The match could not run." };
  return { ok: true, view };
}

export async function getFirmDetail(
  clientId: string,
  firmId: string,
): Promise<Result<{ detail: FirmDetail }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const run = await runClientMatch(access.supabase, clientId);
  if (!run.ok) return run;
  const detail = buildDetail(run.value, String(firmId));
  if (!detail) return { ok: false, error: "This fund is no longer in the results." };
  return { ok: true, detail };
}

// ---------------------------------------------------------------------------
// Reviews

export async function reviewFirm(
  clientId: string,
  input: {
    firmId: string;
    firmName: string;
    tier: Tier;
    status: "ok" | "no";
    reason?: string;
    note?: string;
    hideForAll?: boolean;
  },
): Promise<Result<{ view: MatchView }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const firmId = String(input?.firmId ?? "").slice(0, 40);
  const firmName = String(input?.firmName ?? "").slice(0, 255);
  if (!firmId) return { ok: false, error: "Unknown fund." };
  const status = input.status === "no" ? "no" : "ok";
  const reason = String(input.reason ?? "");
  if (status === "no" && !REJECT_REASONS.includes(reason)) {
    return { ok: false, error: "Choose a reason for rejecting." };
  }
  const note = String(input.note ?? "").trim().slice(0, 1000);

  const { error } = await access.supabase.from("match_reviews").upsert(
    {
      client_id: clientId,
      firm_id: firmId,
      firm_name: firmName,
      status,
      reason: status === "no" ? reason : null,
      note: note || null,
      tier: ["bullseye", "match", "expansion"].includes(input.tier) ? input.tier : null,
      reviewed_by: access.email,
      reviewed_at: nowIso(),
    },
    { onConflict: "client_id,firm_id" },
  );
  if (error) return { ok: false, error: matchTableError(error.message, error.code) };

  if (status === "no" && input.hideForAll) {
    const { error: hideError } = await access.supabase.from("match_suppressions").upsert(
      {
        firm_id: firmId,
        firm_name: firmName,
        reason: reason + (note ? `: ${note}` : ""),
        from_client: clientId,
        created_by: access.email,
      },
      { onConflict: "firm_id" },
    );
    if (hideError) return { ok: false, error: matchTableError(hideError.message, hideError.code) };
  }

  const { view, error: runError } = await viewFor(access.supabase, clientId);
  if (!view) return { ok: false, error: runError ?? "The match could not run." };
  return { ok: true, view };
}

export async function clearFirmReview(
  clientId: string,
  firmId: string,
): Promise<Result<{ view: MatchView }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const { error } = await access.supabase
    .from("match_reviews")
    .delete()
    .eq("client_id", clientId)
    .eq("firm_id", String(firmId));
  if (error) return { ok: false, error: matchTableError(error.message, error.code) };
  const { view, error: runError } = await viewFor(access.supabase, clientId);
  if (!view) return { ok: false, error: runError ?? "The match could not run." };
  return { ok: true, view };
}

/** Shows a fund hidden for all clients again. */
export async function restoreHiddenFund(
  clientId: string,
  firmId: string,
): Promise<Result<{ view: MatchView }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const { error } = await access.supabase
    .from("match_suppressions")
    .delete()
    .eq("firm_id", String(firmId));
  if (error) return { ok: false, error: matchTableError(error.message, error.code) };
  const { view, error: runError } = await viewFor(access.supabase, clientId);
  if (!view) return { ok: false, error: runError ?? "The match could not run." };
  return { ok: true, view };
}

// ---------------------------------------------------------------------------
// Websites and sending to the client

/** Re-checks this client's top funds per tier whose result is old or missing. */
export async function checkClientWebsites(
  clientId: string,
): Promise<
  Result<{ view: MatchView; checked: number; pending: number; summary: Record<string, number> }>
> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const run = await runClientMatch(access.supabase, clientId);
  if (!run.ok) return run;
  const { out, profile, live, checkedAt } = run.value;
  if (profile.siteN <= 0) {
    return { ok: false, error: "The website check is off for this client. Turn it on under Rules." };
  }
  const due = siteCandidates(out, live.db, profile.siteN).filter(
    (firm) => firm.web && isStale(checkedAt[firm.id]),
  );
  let checked = 0;
  let summary: Record<string, number> = {};
  if (due.length > 0) {
    const result = await checkAndStoreSites(access.supabase, due, SITE_BUDGET_MS);
    if (!result.ok) return result;
    checked = result.checked;
    summary = result.summary;
  }
  const { view, error } = await viewFor(access.supabase, clientId);
  if (!view) return { ok: false, error: error ?? "The match could not run." };
  return { ok: true, view, checked, pending: Math.max(0, due.length - checked), summary };
}

/**
 * Publishes the fund list (funds, tiers, websites and contact counts; never
 * people) on the client's Investor List. The client can open it immediately.
 * The Match Sandbox skips the Setup gate and is never emailed.
 */
export async function sendMatchToClient(
  clientId: string,
): Promise<Result<{ funds: number; emailed: boolean; emailError: string | null; sandbox: boolean }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const run = await runClientMatch(access.supabase, clientId);
  if (!run.ok) return run;
  const list = buildClientList(run.value);
  if (!list.ok) return list;
  const draft = asInvestorList(list.value);
  if (draft.rows.length === 0) return { ok: false, error: "No funds in the tiers to send." };

  const [{ data: client, error: clientError }, grouped] = await Promise.all([
    access.supabase
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .maybeSingle(),
    loadSetupSteps(access.supabase, [clientId]),
  ]);
  if (clientError) return { ok: false, error: clientError.message };
  if (!client) return { ok: false, error: "Client not found." };
  const rows = grouped.get(clientId) ?? [];
  const sandbox = client.is_match_sandbox === true;
  const source = {
    stage: client.stage != null ? String(client.stage) : null,
    intake_completed_at:
      client.intake_completed_at != null ? String(client.intake_completed_at) : null,
    setup_steps: rows,
  };
  if (!sandbox && !canPublish(source, "investor_list")) {
    return { ok: false, error: INVESTOR_LIST_BLOCKED };
  }
  const row = rows.find((item) => item.step === "investor_list") ?? null;
  const later = rows.some((item) => item.step === "email_copy" && item.version > 0);
  if (!sandbox && row?.status === "confirmed" && later) {
    return {
      ok: false,
      error:
        "The client already confirmed this and later steps are under way. Talk to the client before changing it.",
    };
  }

  const at = nowIso();
  const version = (row?.version ?? 0) + 1;
  const values = {
    client_id: clientId,
    step: "investor_list" as const,
    status: "with_client" as const,
    draft,
    published: draft,
    version,
    published_at: at,
    response: null,
    history: [...(row?.history ?? []), { version, published_at: at, response: null }],
    turn_since: at,
    completed_at: null,
    client_viewed_at: null,
    updated_at: at,
  };

  if (row) {
    const { data, error } = await access.supabase
      .from("setup_steps")
      .update(values)
      .eq("client_id", clientId)
      .eq("step", "investor_list")
      .eq("version", row.version)
      .select("client_id");
    if (error) return { ok: false, error: setupTableError(error.message, error.code) };
    if (!data || data.length === 0) {
      return { ok: false, error: "This step changed meanwhile. Refresh and try again." };
    }
  } else {
    const { error } = await access.supabase.from("setup_steps").insert(values);
    if (error) {
      return {
        ok: false,
        error:
          error.code === "23505"
            ? "This step changed meanwhile. Refresh and try again."
            : setupTableError(error.message, error.code),
      };
    }
  }

  const clientEmail = sandbox
    ? null
    : await notifyClient(access.supabase, clientId, "investor_list_ready", {
        updated: version > 1,
      });
  revalidateMatch(clientId);
  revalidatePath("/portal", "layout");
  revalidatePath("/portal/setup", "layout");
  return {
    ok: true,
    funds: draft.rows.length,
    emailed: Boolean(clientEmail?.ok),
    emailError: clientEmail && !clientEmail.ok ? clientEmail.reason : null,
    sandbox,
  };
}
