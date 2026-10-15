"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { loadMaterialFields } from "@/lib/material-fields-server";
import {
  labelledAnswers,
  materialFieldProblems,
  type MaterialField,
} from "@/lib/material-fields";
import { notifyAdmin } from "@/lib/notify";
import { requirePortalService, type PortalAccess } from "@/lib/portal-access";
import {
  FIT_TIERS,
  MATERIALS_BUCKET,
  MATERIAL_EXTENSIONS,
  MATERIAL_MAX_BYTES,
  MATERIAL_MAX_FILES,
  NOTE_MAX,
  asInvestorList,
  asMaterials,
  fileExtension,
  formatBytes,
  isSetupComplete,
  type MaterialFile,
  type MaterialsPayload,
  type SetupDecision,
  type SetupResponse,
  type SetupStepState,
} from "@/lib/setup";
import { loadSetupStep, loadSetupSteps, nowIso, setupTableError } from "@/lib/setup-server";

export type SetupActionResult = { ok: true } | { ok: false; error: string };

const TEXT_MAX = 20000;

function revalidateSetup(clientId: string) {
  revalidatePath("/portal", "layout");
  revalidatePath("/portal/setup", "layout");
  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/clients/${clientId}`);
}

/** The client's row, if Setup is open to them. */
async function loadSetupClient({ user, supabase }: PortalAccess) {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "Client record not found." };
  const client = data as Record<string, unknown>;
  if (!client.intake_completed_at) {
    return {
      ok: false as const,
      error: "Setup opens once your intake is complete.",
    };
  }
  return { ok: true as const, client };
}

/** Loads the materials row, creating an empty draft the first time. */
async function loadMaterials(access: PortalAccess) {
  const loaded = await loadSetupStep(access.supabase, access.user.id, "materials");
  if (!loaded.ok) return loaded;
  if (loaded.row) return { ok: true as const, row: loaded.row };

  const { error } = await access.supabase.from("setup_steps").insert({
    client_id: access.user.id,
    step: "materials",
    status: "draft",
    draft: { files: [], fields: {} },
  });
  if (error && error.code !== "23505") {
    return { ok: false as const, error: setupTableError(error.message, error.code) };
  }
  const again = await loadSetupStep(access.supabase, access.user.id, "materials");
  if (!again.ok) return again;
  if (!again.row) return { ok: false as const, error: "Unable to start Setup." };
  return { ok: true as const, row: again.row };
}

async function openMaterialsDraft() {
  const access = await requirePortalService();
  if (!access.ok) return access;
  const opened = await loadSetupClient(access);
  if (!opened.ok) return opened;
  const loaded = await loadMaterials(access);
  if (!loaded.ok) return loaded;
  if (loaded.row.status === "submitted") {
    return {
      ok: false as const,
      error: "Your materials are submitted. Rupert will reopen them if he needs more.",
    };
  }
  return { ok: true as const, access, row: loaded.row };
}

async function saveDraft(
  access: PortalAccess,
  row: SetupStepState,
  draft: MaterialsPayload,
) {
  const { data, error } = await access.supabase
    .from("setup_steps")
    .update({ draft, updated_at: nowIso() })
    .eq("client_id", access.user.id)
    .eq("step", "materials")
    .eq("status", "draft")
    .eq("updated_at", row.updated_at)
    .select("client_id");

  if (error) return { ok: false as const, error: setupTableError(error.message, error.code) };
  if (!data || data.length === 0) {
    return {
      ok: false as const,
      error: "Your materials changed in another window. Refresh and try again.",
    };
  }
  return { ok: true as const };
}

function safeFileName(name: string) {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(-120);
  return cleaned || "file";
}

/**
 * Step 1 of an upload: checks the file and returns a one-time signed URL the
 * browser uploads to directly (large decks never pass through our server).
 */
export async function createMaterialUpload(file: {
  name: string;
  size: number;
}): Promise<
  { ok: true; path: string; token: string } | { ok: false; error: string }
> {
  const opened = await openMaterialsDraft();
  if (!opened.ok) return opened;

  const name = String(file?.name ?? "").trim();
  const size = Number(file?.size) || 0;
  const extension = fileExtension(name);
  if (!name) return { ok: false, error: "The file has no name." };
  if (!MATERIAL_EXTENSIONS.includes(extension)) {
    return {
      ok: false,
      error: `${name}: this file type is not supported. Use PDF, PowerPoint, Keynote, Word, Excel, CSV, text or images.`,
    };
  }
  if (size <= 0) return { ok: false, error: `${name} is empty.` };
  if (size > MATERIAL_MAX_BYTES) {
    return {
      ok: false,
      error: `${name} is ${formatBytes(size)}. The limit is ${formatBytes(MATERIAL_MAX_BYTES)} per file.`,
    };
  }
  if (asMaterials(opened.row.draft).files.length >= MATERIAL_MAX_FILES) {
    return {
      ok: false,
      error: `You can upload up to ${MATERIAL_MAX_FILES} files. Remove one to add another.`,
    };
  }

  const path = `${opened.access.user.id}/${randomUUID()}/${safeFileName(name)}`;
  const { data, error } = await opened.access.supabase.storage
    .from(MATERIALS_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    return {
      ok: false,
      error: `Upload could not start: ${error?.message ?? "unknown error"}. If this keeps happening, use Book a call.`,
    };
  }
  return { ok: true, path: data.path, token: data.token };
}

/** Step 2 of an upload: records the uploaded file on the draft. */
export async function registerMaterialFile(file: {
  path: string;
  name: string;
  size: number;
  type: string;
}): Promise<{ ok: true; file: MaterialFile } | { ok: false; error: string }> {
  const opened = await openMaterialsDraft();
  if (!opened.ok) return opened;
  const { access, row } = opened;

  const path = String(file?.path ?? "");
  if (!path.startsWith(`${access.user.id}/`) || path.includes("..")) {
    return { ok: false, error: "That upload does not belong to you." };
  }

  const draft = asMaterials(row.draft);
  if (draft.files.some((item) => item.path === path)) {
    return { ok: false, error: "That file is already attached." };
  }
  if (draft.files.length >= MATERIAL_MAX_FILES) {
    return { ok: false, error: `You can upload up to ${MATERIAL_MAX_FILES} files.` };
  }

  const entry: MaterialFile = {
    path,
    name: String(file?.name ?? "file").slice(0, 255),
    size: Number(file?.size) || 0,
    type: String(file?.type ?? "").slice(0, 120),
    uploaded_at: nowIso(),
  };

  const saved = await saveDraft(access, row, {
    ...draft,
    files: [...draft.files, entry],
  });
  if (!saved.ok) return saved;

  revalidateSetup(access.user.id);
  return { ok: true, file: entry };
}

export async function removeMaterialFile(path: string): Promise<SetupActionResult> {
  const opened = await openMaterialsDraft();
  if (!opened.ok) return opened;
  const { access, row } = opened;

  const draft = asMaterials(row.draft);
  if (!draft.files.some((item) => item.path === path)) {
    return { ok: false, error: "That file is no longer attached." };
  }

  const saved = await saveDraft(access, row, {
    ...draft,
    files: draft.files.filter((item) => item.path !== path),
  });
  if (!saved.ok) return saved;

  // Best effort: a leftover file in private storage is harmless.
  await access.supabase.storage.from(MATERIALS_BUCKET).remove([path]);

  revalidateSetup(access.user.id);
  return { ok: true };
}

/**
 * Merges the client's answers into the draft. Only fields that exist in
 * Forms → Company Materials are taken; answers to fields removed since are
 * kept as they were.
 */
function mergeFields(
  fields: MaterialField[],
  current: Record<string, string>,
  input: unknown,
) {
  const values =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const merged = { ...current };
  for (const field of fields) {
    if (values[field.id] !== undefined) {
      merged[field.id] = String(values[field.id] ?? "").trim().slice(0, TEXT_MAX);
    }
  }
  return merged;
}

export async function saveMaterialsFields(
  input: Record<string, string>,
): Promise<SetupActionResult> {
  const opened = await openMaterialsDraft();
  if (!opened.ok) return opened;
  const { access, row } = opened;

  const fields = await loadMaterialFields(access.supabase);
  const draft = asMaterials(row.draft);
  const saved = await saveDraft(access, row, {
    ...draft,
    fields: mergeFields(fields, draft.fields, input),
  });
  if (!saved.ok) return saved;

  revalidateSetup(access.user.id);
  return { ok: true };
}

/** Submits the materials: the turn passes to Rupert. */
export async function submitMaterials(
  input: Record<string, string>,
): Promise<SetupActionResult> {
  const opened = await openMaterialsDraft();
  if (!opened.ok) return opened;
  const { access, row } = opened;

  const fields = await loadMaterialFields(access.supabase);
  const draft = asMaterials(row.draft);
  const payload: MaterialsPayload = {
    ...draft,
    fields: mergeFields(fields, draft.fields, input),
  };

  const problems = materialFieldProblems(fields, payload.fields);
  if (problems.length > 0) return { ok: false, error: problems.join(" ") };

  const answers = labelledAnswers(fields, payload.fields);
  if (payload.files.length === 0 && answers.length === 0) {
    return {
      ok: false,
      error: "Upload your pitch deck or tell us about the company before submitting.",
    };
  }

  const at = nowIso();
  const version = row.version + 1;
  const { data, error } = await access.supabase
    .from("setup_steps")
    .update({
      status: "submitted",
      draft: payload,
      published: payload,
      version,
      published_at: at,
      history: [...row.history, { version, published_at: at, response: null }],
      turn_since: at,
      completed_at: at,
      updated_at: at,
    })
    .eq("client_id", access.user.id)
    .eq("step", "materials")
    .eq("status", "draft")
    .eq("version", row.version)
    .select("client_id");

  if (error) return { ok: false, error: setupTableError(error.message, error.code) };
  if (!data || data.length === 0) {
    return { ok: false, error: "Already submitted. Refresh to see the latest." };
  }

  const details = [
    payload.files.length > 0
      ? `Files:\n${payload.files.map((file) => `- ${file.name} (${formatBytes(file.size)})`).join("\n")}`
      : "No files uploaded.",
    ...answers.map((answer) => `${answer.label}:\n${excerpt(answer.value)}`),
  ]
    .filter(Boolean)
    .join("\n\n");

  await notifyAdmin(access.supabase, access.user.id, "materials_submitted", {
    email: true,
    details,
  });

  revalidateSetup(access.user.id);
  return { ok: true };
}

function excerpt(value: string, max = 1200) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

// ---------------------------------------------------------------------------
// Reviews: framing, investor list, email copy

type ReviewStep = "framing" | "investor_list" | "email_copy";

const REVIEW_STEPS = new Set<ReviewStep>(["framing", "investor_list", "email_copy"]);

function itemLabel(
  step: ReviewStep,
  row: SetupStepState,
): (key: string) => string {
  if (step === "investor_list") {
    const rows = asInvestorList(row.published).rows;
    return (key) => rows.find((item) => item.id === key)?.fund_name ?? key;
  }
  if (step === "email_copy") {
    return (key) =>
      FIT_TIERS.find((tier) => `tier_${tier.tier}` === key)?.label ?? key;
  }
  return (key) => key;
}

export async function respondToSetupStep(input: {
  step: string;
  version: number;
  decision: SetupDecision;
  note: string;
  itemNotes?: Record<string, string>;
}): Promise<SetupActionResult> {
  const access = await requirePortalService();
  if (!access.ok) return access;
  const opened = await loadSetupClient(access);
  if (!opened.ok) return opened;

  const step = input?.step as ReviewStep;
  if (!REVIEW_STEPS.has(step)) return { ok: false, error: "Unknown step." };
  if (input.decision !== "confirmed" && input.decision !== "changes_requested") {
    return { ok: false, error: "Choose confirm or request changes." };
  }

  const loaded = await loadSetupStep(access.supabase, access.user.id, step);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (!row || row.status !== "with_client") {
    return { ok: false, error: "There is nothing waiting for your review here." };
  }
  if (Number(input.version) !== row.version) {
    return {
      ok: false,
      error: "Rupert has updated this since you opened it. Refresh to see the latest.",
    };
  }

  const note = String(input.note ?? "").trim().slice(0, NOTE_MAX);
  // Only notes on items that exist in this version (funds or tiers) are kept.
  const label = itemLabel(step, row);
  const itemNotes: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.itemNotes ?? {})) {
    const text = String(value ?? "").trim().slice(0, NOTE_MAX);
    if (text && label(key) !== key) itemNotes[key] = text;
  }
  if (
    input.decision === "changes_requested" &&
    !note &&
    Object.keys(itemNotes).length === 0
  ) {
    return { ok: false, error: "Tell Rupert what to change or what you'd like to ask." };
  }

  const itemLabels: Record<string, string> = {};
  for (const key of Object.keys(itemNotes)) itemLabels[key] = label(key);

  const at = nowIso();
  const response: SetupResponse = {
    decision: input.decision,
    note,
    item_notes: itemNotes,
    item_labels: itemLabels,
    version: row.version,
    at,
  };
  const history = row.history.map((entry) =>
    entry.version === row.version ? { ...entry, response } : entry,
  );
  const confirmed = input.decision === "confirmed";

  const { data, error } = await access.supabase
    .from("setup_steps")
    .update({
      status: confirmed ? "confirmed" : "changes_requested",
      response,
      history,
      turn_since: at,
      completed_at: confirmed ? at : null,
      updated_at: at,
    })
    .eq("client_id", access.user.id)
    .eq("step", step)
    .eq("status", "with_client")
    .eq("version", row.version)
    .select("client_id");

  if (error) return { ok: false, error: setupTableError(error.message, error.code) };
  if (!data || data.length === 0) {
    return { ok: false, error: "This was already answered. Refresh to see the latest." };
  }

  const notesText = Object.entries(itemNotes)
    .map(([key, value]) => `- ${label(key)}: ${value}`)
    .join("\n");

  // Setup complete? Then say so in the admin email.
  const all = await loadSetupSteps(access.supabase, [access.user.id]);
  const complete = isSetupComplete({
    stage: String(opened.client.stage ?? ""),
    intake_completed_at: String(opened.client.intake_completed_at ?? ""),
    setup_steps: all.get(access.user.id) ?? [],
  });

  const details = [
    note ? `Their note:\n${note}` : confirmed ? "No note." : "",
    notesText ? `${step === "investor_list" ? "On specific funds" : "By tier"}:\n${notesText}` : "",
    complete
      ? "Setup is complete: every step is confirmed. Next: issue the first monthly invoice."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  await notifyAdmin(
    access.supabase,
    access.user.id,
    `${step}_${confirmed ? "confirmed" : "changes_requested"}`,
    { email: true, details },
  );

  revalidateSetup(access.user.id);
  return { ok: true };
}
