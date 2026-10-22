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
  extractAnswers,
  loadProfileState,
  saveProfileState,
} from "@/lib/match/profile-server";
import {
  applyContactImport,
  discardContactImport,
  reapplyImportedContacts,
  stageContactImport,
} from "@/lib/match/import-server";
import { clientFacingList, visibleFundCount } from "@/lib/match/client-list-dedupe";
import { withVerificationSnapshot, type PeopleStates } from "@/lib/match/list-snapshot";
import { fourTierPushList } from "@/lib/match/tiers/server";
import { loadPlanForRun, plannedIds } from "@/lib/match/capacity/server";
import { carryDuplicateFlags, listedContacts } from "@/lib/match/outreach-dedupe";
import { runSiteBatch } from "@/lib/match/sites-server";
import { IMPORT_MAX_BYTES, type ContactImportView } from "@/lib/match/contact-import";
import {
  DEFAULT_SETTINGS,
  FUND_DB_BUCKET,
  FUND_DB_MAX_BYTES,
  FUND_UPLOAD_CHUNK_BYTES,
  type FundDbVersion,
  type MatchProfileState,
} from "@/lib/match/shared";
import {
  asInvestorList,
  asInvestorListDraft,
  investorFlagsFrom,
  retainInvestorFlags,
  type InvestorListPayload,
  type SetupStepState,
} from "@/lib/setup";
import { loadSetupSteps, nowIso, setupTableError } from "@/lib/setup-server";
import { createServiceClient } from "@/lib/supabase/admin";
import { answersBasis, founderTranscript } from "@/lib/company-profile/core";
import { profileFromIntake, recordCurrent, saveVersion, versionAfterEdit } from "@/lib/company-profile/server";
import { loadTaxonomy, previewNewValues, runCoverage } from "@/lib/taxonomy/server";

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
  revalidatePath(`/admin/clients/${clientId}/profile`);
  revalidatePath("/admin/fund-database");
  revalidatePath("/admin/matching");
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

    // Contacts added by CSV go back on top of the provider's workbook.
    const reapplied = await reapplyImportedContacts(supabase, built.value.db);
    if (!reapplied.ok) {
      await discardUpload();
      return { ok: false, error: reapplied.error };
    }
    const { offices, warnings } = built.value;
    const { db, counts } = reapplied.value;
    const diff = {
      ...diffFundDb(live.ok ? live.value.db : null, db, reviewedIds, warnings),
      reapplied: counts,
      taxonomy: await previewNewValues(supabase, db),
    };

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
  await refreshTaxonomyCoverage(access.supabase, access.email);
  revalidatePath("/admin/fund-database");
  return { ok: true };
}

/**
 * Maps the new live database to the investor taxonomy. A failure here never
 * undoes the apply: the Taxonomy page shows the coverage as out of date.
 */
async function refreshTaxonomyCoverage(supabase: ReturnType<typeof createServiceClient>, actor: string | null) {
  try {
    await runCoverage(supabase, actor);
  } catch {
    // Reported on the Taxonomy page, where it can be recomputed.
  }
  revalidatePath("/admin/taxonomy");
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

// ---------------------------------------------------------------------------
// Adding contacts by CSV

/** Reads a CSV of contacts and keeps it for the preview. Nothing changes until Apply. */
export async function stageContacts(
  fileName: string,
  text: string,
): Promise<Result<{ staged: ContactImportView }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const name = String(fileName ?? "");
  const body = String(text ?? "");
  if (!/\.(csv|tsv|txt)$/i.test(name)) return { ok: false, error: "Upload a .csv file." };
  if (Buffer.byteLength(body, "utf8") > IMPORT_MAX_BYTES) {
    return { ok: false, error: "The file must be under 3 MB. Split it into smaller files." };
  }
  try {
    const staged = await stageContactImport(access.supabase, name, body, access.email);
    if (!staged.ok) return { ok: false, error: staged.error };
    revalidatePath("/admin/fund-database");
    return { ok: true, staged: staged.value };
  } catch (err) {
    return { ok: false, error: errorText(err, "The CSV could not be read.") };
  }
}

export async function applyContacts(id: string): Promise<Result<{ added: number }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  try {
    const applied = await applyContactImport(access.supabase, String(id), access.email);
    if (!applied.ok) return { ok: false, error: applied.error };
    await refreshTaxonomyCoverage(access.supabase, access.email);
    revalidatePath("/admin/fund-database");
    return { ok: true, added: applied.value.added };
  } catch (err) {
    return { ok: false, error: errorText(err, "The contacts could not be added.") };
  }
}

export async function discardContacts(id: string): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const error = await discardContactImport(access.supabase, String(id));
  if (error) return { ok: false, error };
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

  // With the investor taxonomy, the AI also classifies the company, with
  // founder evidence; without it, the profile is built as before.
  const taxonomy = await loadTaxonomy(supabase);
  const index = taxonomy.ok ? taxonomy.value : null;
  const extracted = await extractAnswers(supabase, client as Record<string, unknown>, interview, index);
  if (!extracted.ok) return extracted;

  const settings = current.value?.settings ?? DEFAULT_SETTINGS;
  const built =
    index && extracted.classification
      ? profileFromIntake({
          answers: extracted.answers,
          settings,
          index,
          classification: extracted.classification,
          transcript: founderTranscript(interview.messages),
          interviewAt: interview.updated_at,
        })
      : null;

  // Keep the profile as it was before the rebuild replaces it. Like the new
  // version below, this never blocks the rebuild.
  if (index && current.value) {
    await recordCurrent(supabase, clientId, current.value, index, access.email);
  }
  const saved = await saveProfileState(supabase, clientId, {
    answers: built ? built.answers : extracted.answers,
    settings,
    source: "intake",
    sourceInterviewAt: interview.updated_at,
  });
  if (!saved.ok) return saved;
  if (built && index) {
    // A version that can't be saved (e.g. the table isn't set up) never
    // blocks the profile; the Classification panel says what is missing.
    await saveVersion(supabase, clientId, {
      profile: { ...built.profile, provenance: { ...built.profile.provenance, basis: answersBasis(saved.value.answers) } },
      index,
      source: "intake_ai",
      actor: access.email,
      problems: built.problems,
      note: built.unusable.length > 0 ? `Not usable by the current engine: ${built.unusable.join(", ")}.` : "",
    });
  }
  revalidateMatch(clientId);
  return { ok: true, state: saved.value };
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
  const taxonomy = await loadTaxonomy(access.supabase);
  if (taxonomy.ok) {
    // As above: a version that can't be saved never blocks the edit.
    await versionAfterEdit(access.supabase, clientId, current.value, saved.value, taxonomy.value, access.email);
  }
  revalidateMatch(clientId);
  return { ok: true, state: saved.value };
}

/** Shows a fund hidden for all clients again. */
export async function restoreHiddenFund(clientId: string, firmId: string): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const { error } = await access.supabase
    .from("match_suppressions")
    .delete()
    .eq("firm_id", String(firmId));
  if (error) return { ok: false, error: matchTableError(error.message, error.code) };
  revalidateMatch(String(clientId));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sending to the client

/**
 * Pushes one saved run's confirmed campaign plan to the client's page as a
 * draft, exactly as saved: the plan's funds (never people), with the run id
 * and rules version on the list. Refused without a confirmed plan for the
 * run. The client sees nothing and is not emailed until Rupert sends it
 * from the client page. The test client has no client page: its list is
 * published straight to its own test portal (never emailed). Refused when the
 * run is not the client's newest or no longer reflects the client's data.
 */
export async function pushRunToClient(
  clientId: string,
  runId: string,
): Promise<Result<{ funds: number; sandbox: boolean }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const id = String(runId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(String(clientId ?? ""))) {
    return { ok: false, error: "Unknown run." };
  }
  const plan = await loadPlanForRun(access.supabase, clientId, id);
  if (!plan.ok) return plan;
  if (!plan.value) return { ok: false, error: "Confirm a campaign plan for this run on the Plan tab, then push." };
  const built = await fourTierPushList(access.supabase, clientId, id, plannedIds(plan.value));
  if (!built.ok) return built;
  return deliverList(access, clientId, built.value.list, built.value.people);
}

/** Saves a built list as the client's draft (or publishes it on the Test Pilot portal). */
async function deliverList(
  access: { supabase: ReturnType<typeof createServiceClient> },
  clientId: string,
  built: InvestorListPayload,
  people: PeopleStates,
): Promise<Result<{ funds: number; sandbox: boolean }>> {
  const snapshotted = await withVerificationSnapshot(
    access.supabase,
    clientId,
    people,
    clientFacingList(built),
  );
  const fresh = asInvestorList(snapshotted);
  const shown = visibleFundCount(fresh.rows);
  if (shown === 0) return { ok: false, error: "No funds in the tiers to push." };

  const [{ data: client, error: clientError }, grouped] = await Promise.all([
    access.supabase
      .from("clients")
      .select("id, is_match_sandbox")
      .eq("id", clientId)
      .maybeSingle(),
    loadSetupSteps(access.supabase, [clientId]),
  ]);
  if (clientError) return { ok: false, error: clientError.message };
  if (!client) return { ok: false, error: "Client not found." };
  const rows = grouped.get(clientId) ?? [];
  const sandbox = client.is_match_sandbox === true;
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
  const current = asInvestorListDraft(row?.draft);
  const previous = asInvestorList(row?.published);
  const names = new Map<string, string>();
  for (const item of [...previous.rows, ...current.rows]) names.set(item.id, item.fund_name);
  const retained = retainInvestorFlags(
    { ...investorFlagsFrom(row?.published), ...investorFlagsFrom(row?.draft) },
    [...(previous.removed_flags ?? []), ...(current.removed_flags ?? [])],
    names,
    new Set(fresh.rows.map((item) => item.id)),
  );
  const carried = carryDuplicateFlags(
    fresh.rows.map((item) => ({
      id: item.id,
      web: item.website ?? "",
        contacts: listedContacts(item.contact_count, item.contact),
    })),
    retained.client_flags,
  );
  const withFlags = { ...fresh, ...retained, ...(carried ? { client_flags: carried } : {}) };

  if (sandbox) {
    const published = await publishSandboxList(access.supabase, clientId, row, withFlags, at);
    if (!published.ok) return published;
    revalidateMatch(clientId);
    revalidatePath("/portal", "layout");
    revalidatePath("/portal/setup", "layout");
    return { ok: true, funds: shown, sandbox };
  }

  // Keep the email and the page note. Flags from a hidden duplicate sit on the fund the client sees.
  const draft = {
    ...withFlags,
    admin_note: current.admin_note,
    client_email: current.client_email,
  };
  const { error } = await access.supabase.from("setup_steps").upsert(
    { client_id: clientId, step: "investor_list", draft, updated_at: at },
    { onConflict: "client_id,step", ignoreDuplicates: false },
  );
  if (error) return { ok: false, error: setupTableError(error.message, error.code) };

  revalidateMatch(clientId);
  return { ok: true, funds: shown, sandbox };
}

/** Publishes the Match Sandbox's list on the Test Pilot portal. No email. */
async function publishSandboxList(
  supabase: ReturnType<typeof createServiceClient>,
  clientId: string,
  row: SetupStepState | null,
  list: InvestorListPayload,
  at: string,
): Promise<Result<object>> {
  const version = (row?.version ?? 0) + 1;
  const values = {
    client_id: clientId,
    step: "investor_list" as const,
    status: "with_client" as const,
    draft: list,
    published: list,
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
    const { data, error } = await supabase
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
    return { ok: true };
  }
  const { error } = await supabase.from("setup_steps").insert(values);
  if (error) {
    return {
      ok: false,
      error:
        error.code === "23505"
          ? "This step changed meanwhile. Refresh and try again."
          : setupTableError(error.message, error.code),
    };
  }
  return { ok: true };
}
