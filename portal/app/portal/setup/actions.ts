"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { loadMaterialFields } from "@/lib/material-fields-server";
import {
  labelledAnswers,
  materialFieldProblems,
  type MaterialField,
} from "@/lib/material-fields";
import { advanceStage } from "@/lib/kickoff";
import { attachMaterialFile, safeFileName } from "@/lib/materials-server";
import { notifyAdmin } from "@/lib/notify";
import { requirePortalService, type PortalAccess } from "@/lib/portal-access";
import {
  MATERIALS_BUCKET,
  MATERIAL_EXTENSIONS,
  MATERIAL_MAX_BYTES,
  MATERIAL_MAX_FILES,
  MATERIALS_FEEDBACK_NOTE_KEY,
  NOTE_MAX,
  QUESTION_MAX,
  addQuestion,
  questionsOf,
  asEmailCopy,
  asFeedbackPublished,
  asInvestorList,
  asMaterials,
  fitTiersFor,
  investorFlagsFrom,
  type InvestorFundFlag,
  fileExtension,
  formatBytes,
  isSetupComplete,
  isSharedWithClient,
  type MaterialFile,
  type MaterialsPayload,
  type SetupDecision,
  type SetupResponse,
  type SetupStepState,
} from "@/lib/setup";
import { commitFundFlag, type FlagPatch } from "@/lib/investor-flags";
import {
  loadSetupStep,
  loadSetupSteps,
  nowIso,
  saveQuestions,
  setupTableError,
} from "@/lib/setup-server";

export type SetupActionResult = { ok: true } | { ok: false; error: string };

const TEXT_MAX = 20000;

function revalidateSetup(clientId: string) {
  revalidatePath("/portal", "layout");
  revalidatePath("/portal/setup", "layout");
  revalidatePath("/portal/materials");
  revalidatePath("/portal/onboarding");
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
  if (!again.row) return { ok: false as const, error: "Unable to start company materials." };
  return { ok: true as const, row: again.row };
}

/** The materials row, open for adding files (also after they are submitted). */
async function openMaterialsForFiles() {
  const access = await requirePortalService();
  if (!access.ok) return access;
  const opened = await loadSetupClient(access);
  if (!opened.ok) return opened;
  const loaded = await loadMaterials(access);
  if (!loaded.ok) return loaded;
  return { ok: true as const, access, row: loaded.row };
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
  const opened = await openMaterialsForFiles();
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
  const current = asMaterials(
    opened.row.status === "submitted" ? opened.row.published : opened.row.draft,
  );
  if (current.files.length >= MATERIAL_MAX_FILES) {
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

/**
 * Step 2 of an upload: records the uploaded file. Before the materials are
 * submitted it goes on the draft; after, it is added to what Rupert has and
 * he is notified in the app.
 */
export async function registerMaterialFile(file: {
  path: string;
  name: string;
  size: number;
  type: string;
}): Promise<{ ok: true; file: MaterialFile } | { ok: false; error: string }> {
  const opened = await openMaterialsForFiles();
  if (!opened.ok) return opened;
  const { access } = opened;

  const path = String(file?.path ?? "");
  if (!path.startsWith(`${access.user.id}/`) || path.includes("..")) {
    return { ok: false, error: "That upload does not belong to you." };
  }

  const attached = await attachMaterialFile(access.supabase, access.user.id, {
    path,
    name: String(file?.name ?? "file"),
    size: Number(file?.size) || 0,
    type: String(file?.type ?? ""),
  });
  if (!attached.ok) return attached;
  if (attached.late) {
    await notifyAdmin(access.supabase, access.user.id, "materials_added", { email: false });
  }

  revalidateSetup(access.user.id);
  return { ok: true, file: attached.file };
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

  await advanceStage(access.supabase, access.user.id, ["nda", "intake"], "setup");
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
// Reviews: the narrative, the investor list, the email copy

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
    const tiers = fitTiersFor(asEmailCopy(row.published).tier_scheme);
    return (key) => tiers.find((tier) => `tier_${tier.tier}` === key)?.label ?? key;
  }
  // The narrative takes one comment beside it: on the Company Materials Feedback.
  return (key) => (key === MATERIALS_FEEDBACK_NOTE_KEY ? "Company Materials Feedback" : key);
}

/** How the item notes are introduced in Rupert's notification. */
const ITEM_NOTES_HEADING: Record<ReviewStep, string> = {
  framing: "On the feedback",
  investor_list: "On specific funds",
  email_copy: "By tier",
};

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
  // A comment on the feedback alone doesn't ask for narrative changes.
  const changeNotes = Object.keys(itemNotes).filter((key) => key !== MATERIALS_FEEDBACK_NOTE_KEY);
  if (input.decision === "changes_requested" && !note && changeNotes.length === 0) {
    return {
      ok: false,
      error:
        step === "framing"
          ? "Tell Rupert what to change in the narrative, in the comment box."
          : "Tell Rupert what to change or what you'd like to ask.",
    };
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
    notesText ? `${ITEM_NOTES_HEADING[step]}:\n${notesText}` : "",
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

const QUESTION_HEADING: Record<ReviewStep, string> = {
  framing: "the outreach narrative",
  investor_list: "the investor list",
  email_copy: "the email copy",
};

/**
 * The client asks Rupert a question on a review step. It never changes the
 * turn: they can still confirm. Rupert is notified in-app and by email.
 */
export async function askSetupQuestion(input: {
  step: string;
  version: number;
  question: string;
}): Promise<SetupActionResult> {
  const access = await requirePortalService();
  if (!access.ok) return access;
  const opened = await loadSetupClient(access);
  if (!opened.ok) return opened;

  const step = input?.step as ReviewStep;
  if (!REVIEW_STEPS.has(step)) return { ok: false, error: "Unknown step." };
  const text = String(input.question ?? "").trim();
  if (!text) return { ok: false, error: "Write your question first." };
  if (text.length > QUESTION_MAX) {
    return { ok: false, error: `Please keep your question under ${QUESTION_MAX} characters.` };
  }

  // One retry when another write landed between the read and the save.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const loaded = await loadSetupStep(access.supabase, access.user.id, step);
    if (!loaded.ok) return loaded;
    const row = loaded.row;
    if (!row || row.status !== "with_client") {
      return { ok: false, error: "There is nothing waiting for your review here." };
    }
    if (Number(input.version) !== row.version) {
      return { ok: false, error: "Rupert has updated this since you opened it. Refresh to see the latest." };
    }
    const added = addQuestion(questionsOf(row), {
      id: randomUUID(),
      question: text,
      at: nowIso(),
      version: row.version,
    });
    if (!added.ok) return added;
    const saved = await saveQuestions(access.supabase, row, added.questions);
    if (!saved.ok) return saved;
    if (!saved.saved) continue;

    await notifyAdmin(access.supabase, access.user.id, `${step}_question`, {
      email: true,
      details: `Their question on ${QUESTION_HEADING[step]}:\n${text}\n\nAnswer it on the client page. They can still confirm meanwhile.`,
    });
    revalidateSetup(access.user.id);
    return { ok: true };
  }
  return { ok: false, error: "Your question could not be saved. Please try again." };
}

/** Saves exclude, "I know them", or a note on one fund. Does not change the turn. */
export async function saveInvestorFundFlag(input: {
  version: number;
  fundId: string;
  excluded?: boolean;
  known?: boolean;
  note?: string;
}): Promise<SetupActionResult> {
  const access = await requirePortalService();
  if (!access.ok) return access;

  const fundId = String(input.fundId ?? "").trim().slice(0, 200);
  const version = Number(input.version);
  const patch: FlagPatch = {};
  if (input.excluded === true || input.excluded === false) patch.excluded = input.excluded;
  if (input.known === true || input.known === false) patch.known = input.known;
  if (input.note !== undefined) patch.note = String(input.note).slice(0, NOTE_MAX);

  type Snap = {
    flags: Record<string, InvestorFundFlag>;
    stamp: string;
    draft: unknown;
    published: unknown;
  };

  function withFlags(value: unknown, flags: Record<string, InvestorFundFlag>) {
    const base = value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};
    if (Object.keys(flags).length > 0) base.client_flags = flags;
    else delete base.client_flags;
    return base;
  }

  let saved: Record<string, InvestorFundFlag> | null;
  try {
    saved = await commitFundFlag<Snap>(
      async () => {
        const loaded = await loadSetupStep(access.supabase, access.user.id, "investor_list");
        if (!loaded.ok) throw new Error(loaded.error);
        const row = loaded.row;
        if (!row || row.status !== "with_client") {
          throw new Error("This list is not open for review.");
        }
        if (version !== row.version) {
          throw new Error("Rupert has updated this since you opened it. Refresh to see the latest.");
        }
        const published = asInvestorList(row.published);
        if (!published.rows.some((item) => item.id === fundId)) {
          throw new Error("That fund is not on this list.");
        }
        return {
          flags: { ...investorFlagsFrom(row.draft), ...investorFlagsFrom(row.published) },
          stamp: row.updated_at,
          draft: row.draft,
          published: row.published,
        };
      },
      async (snapshot, flags) => {
        const { data, error } = await access.supabase
          .from("setup_steps")
          .update({
            draft: withFlags(snapshot.draft, flags),
            published: withFlags(snapshot.published, flags),
            updated_at: nowIso(),
          })
          .eq("client_id", access.user.id)
          .eq("step", "investor_list")
          .eq("status", "with_client")
          .eq("version", version)
          .eq("updated_at", snapshot.stamp)
          .select("client_id");
        if (error) throw new Error(setupTableError(error.message, error.code));
        return Boolean(data && data.length > 0);
      },
      fundId,
      patch,
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Your change could not be saved.",
    };
  }
  if (!saved) {
    return { ok: false, error: "Couldn't save, try again" };
  }

  revalidateSetup(access.user.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Analysis & Feedback: the client's own checklist

/** Ticks a recommendation as done (or not) for the client's own tracking. */
export async function toggleFeedbackItem(
  itemId: string,
  done: boolean,
): Promise<SetupActionResult> {
  const access = await requirePortalService();
  if (!access.ok) return access;

  const loaded = await loadSetupStep(access.supabase, access.user.id, "deck_review");
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (!isSharedWithClient(row)) {
    return { ok: false, error: "There is no feedback to track yet." };
  }
  const id = String(itemId ?? "");
  if (!row || !asFeedbackPublished(row.published).items.some((item) => item.id === id)) {
    return { ok: false, error: "That recommendation is no longer in the feedback. Refresh to see the latest." };
  }

  const checks = { ...row.client_checks };
  if (done) checks[id] = nowIso();
  else delete checks[id];

  const { error } = await access.supabase
    .from("setup_steps")
    .update({ client_checks: checks })
    .eq("client_id", access.user.id)
    .eq("step", "deck_review");
  if (error) {
    console.error(`Feedback check not saved: ${error.message}`);
    return { ok: false, error: "Your tick could not be saved. Please try again." };
  }

  revalidatePath("/portal/setup/deck-review");
  revalidatePath(`/admin/clients/${access.user.id}`);
  return { ok: true };
}
