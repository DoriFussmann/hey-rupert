"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { isClaudeConfigured } from "@/lib/anthropic";
import { AGENTS, AGENT_PROMPT_MAX, agentPromptSlug } from "@/lib/agents";
import {
  buildNarrative,
  draftEmailCopy,
  runMaterialsAnalysis,
  saveIntakeBrief,
  writeIntakeBrief,
} from "@/lib/agents-server";
import { asIntakeBrief, type IntakeBrief } from "@/lib/intake";
import { loadInterview } from "@/lib/intake-server";
import {
  MATERIAL_FIELDS_SLUG,
  parseMaterialFields,
} from "@/lib/material-fields";
import {
  MATERIALS_BUCKET,
  MATERIAL_EXTENSIONS,
  MATERIAL_MAX_BYTES,
  asFeedback,
  feedbackFolder,
  fileExtension,
  formatBytes,
  type EmailCopyPayload,
  type FeedbackDraft,
  type NarrativePayload,
} from "@/lib/setup";
import { loadSetupStep, nowIso, setupTableError } from "@/lib/setup-server";
import { createServiceClient } from "@/lib/supabase/admin";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const CLAUDE_MISSING =
  "Claude is not configured. Add ANTHROPIC_API_KEY in Vercel (see Forms → Intake Interviewer → Test Claude).";

async function requireAdmin() {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") {
    return { ok: false as const, error: "You do not have permission to do that." };
  }
  if (!isServiceRoleConfigured()) {
    return { ok: false as const, error: "Service role key is not configured." };
  }
  return { ok: true as const, supabase: createServiceClient() };
}

async function requireAdminWithClaude() {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (!isClaudeConfigured()) return { ok: false as const, error: CLAUDE_MISSING };
  return access;
}

function revalidateClient(clientId: string) {
  revalidatePath(`/admin/clients/${clientId}`);
}

// ---------------------------------------------------------------------------
// Intake brief

export async function generateIntakeBrief(
  clientId: string,
): Promise<Result<{ brief: IntakeBrief }>> {
  const access = await requireAdminWithClaude();
  if (!access.ok) return access;

  const result = await writeIntakeBrief(access.supabase, clientId);
  if (!result.ok) return result;
  revalidateClient(clientId);
  return { ok: true, brief: result.value };
}

export async function updateIntakeBrief(
  clientId: string,
  input: Pick<IntakeBrief, "summary" | "industry" | "geography" | "stage" | "raise_amount">,
): Promise<Result<{ brief: IntakeBrief }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;

  const loaded = await loadInterview(access.supabase, clientId);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const previous = loaded.interview?.admin_brief;
  if (!loaded.interview || !previous) {
    return { ok: false, error: "Generate the summary first." };
  }

  const brief = asIntakeBrief({
    ...previous,
    ...input,
    edited_at: nowIso(),
  });
  if (!brief) return { ok: false, error: "The summary cannot be empty." };

  const result = await saveIntakeBrief(access.supabase, clientId, brief);
  if (!result.ok) return result;
  revalidateClient(clientId);
  return { ok: true, brief: result.value };
}

// ---------------------------------------------------------------------------
// Analysis & Feedback

/** Saves Rupert's feedback draft without touching anything the client sees. */
async function saveFeedbackDraft(
  supabase: ReturnType<typeof createServiceClient>,
  clientId: string,
  draft: FeedbackDraft,
) {
  const { error } = await supabase.from("setup_steps").upsert(
    { client_id: clientId, step: "deck_review", draft, updated_at: nowIso() },
    { onConflict: "client_id,step", ignoreDuplicates: false },
  );
  return error ? setupTableError(error.message, error.code) : null;
}

/**
 * Reads everything the client shared and replaces the summary, framing,
 * opening message and recommendations. Attachments and links are kept.
 */
export async function analyzeClientMaterials(
  clientId: string,
): Promise<Result<{ draft: FeedbackDraft }>> {
  const access = await requireAdminWithClaude();
  if (!access.ok) return access;

  const result = await runMaterialsAnalysis(access.supabase, clientId);
  if (!result.ok) return result;

  const existing = await loadSetupStep(access.supabase, clientId, "deck_review");
  if (!existing.ok) return existing;
  const previous = asFeedback(existing.row?.draft);
  const draft: FeedbackDraft = {
    ...previous,
    analysis: result.value.analysis,
    intro: result.value.intro,
    items: result.value.items,
  };

  const error = await saveFeedbackDraft(access.supabase, clientId, draft);
  if (error) return { ok: false, error };
  revalidateClient(clientId);
  return { ok: true, draft };
}

/**
 * Step 1 of attaching a file to the feedback: a one-time signed upload URL
 * under the client's feedback folder (the browser uploads directly).
 */
export async function createFeedbackUpload(
  clientId: string,
  file: { name: string; size: number },
): Promise<Result<{ path: string; token: string }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;

  const name = String(file?.name ?? "").trim();
  const size = Number(file?.size) || 0;
  if (!name) return { ok: false, error: "The file has no name." };
  if (!MATERIAL_EXTENSIONS.includes(fileExtension(name))) {
    return { ok: false, error: `${name}: this file type is not supported.` };
  }
  if (size <= 0) return { ok: false, error: `${name} is empty.` };
  if (size > MATERIAL_MAX_BYTES) {
    return {
      ok: false,
      error: `${name} is ${formatBytes(size)}. The limit is ${formatBytes(MATERIAL_MAX_BYTES)}.`,
    };
  }

  const { data: client } = await access.supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return { ok: false, error: "Client not found." };

  const safe =
    name
      .normalize("NFKD")
      .replace(/[^\w.\- ]+/g, "")
      .replace(/\s+/g, "-")
      .slice(-120) || "file";
  const path = `${feedbackFolder(clientId)}${randomUUID()}/${safe}`;
  const { data, error } = await access.supabase.storage
    .from(MATERIALS_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    return { ok: false, error: `Upload could not start: ${error?.message ?? "unknown error"}.` };
  }
  return { ok: true, path: data.path, token: data.token };
}

// ---------------------------------------------------------------------------
// Outreach narrative

export async function buildClientNarrative(
  clientId: string,
): Promise<Result<{ narrative: NarrativePayload }>> {
  const access = await requireAdminWithClaude();
  if (!access.ok) return access;

  const result = await buildNarrative(access.supabase, clientId);
  if (!result.ok) return result;

  const { error } = await access.supabase.from("setup_steps").upsert(
    { client_id: clientId, step: "framing", draft: result.value, updated_at: nowIso() },
    { onConflict: "client_id,step", ignoreDuplicates: false },
  );
  if (error) return { ok: false, error: setupTableError(error.message, error.code) };

  revalidateClient(clientId);
  return { ok: true, narrative: result.value };
}

export async function draftClientEmailCopy(
  clientId: string,
): Promise<Result<{ copy: EmailCopyPayload }>> {
  const access = await requireAdminWithClaude();
  if (!access.ok) return access;

  const result = await draftEmailCopy(access.supabase, clientId);
  if (!result.ok) return result;

  const { error } = await access.supabase.from("setup_steps").upsert(
    { client_id: clientId, step: "email_copy", draft: result.value, updated_at: nowIso() },
    { onConflict: "client_id,step", ignoreDuplicates: false },
  );
  if (error) return { ok: false, error: setupTableError(error.message, error.code) };

  revalidateClient(clientId);
  return { ok: true, copy: result.value };
}

// ---------------------------------------------------------------------------
// Settings: AI Agents and Company Materials fields

export async function saveAgentPrompts(
  input: Record<string, string>,
): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;

  const at = nowIso();
  const rows = [];
  for (const agent of AGENTS) {
    const prompt = String(input?.[agent.id] ?? "").trim();
    if (!prompt) return { ok: false, error: `${agent.title}: the instructions cannot be empty.` };
    if (prompt.length > AGENT_PROMPT_MAX) {
      return {
        ok: false,
        error: `${agent.title}: keep the instructions under ${AGENT_PROMPT_MAX} characters.`,
      };
    }
    rows.push({
      slug: agentPromptSlug(agent.id),
      title: `AI agent: ${agent.title}`,
      // Text equal to the default is stored empty, so it follows future defaults.
      content: prompt === agent.defaultPrompt ? "" : prompt,
      updated_at: at,
    });
  }

  const { error } = await access.supabase.from("form_templates").upsert(rows);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/forms/agents");
  return { ok: true };
}

export async function saveMaterialFields(fields: unknown): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;

  const clean = parseMaterialFields(fields);
  if (!clean) {
    return {
      ok: false,
      error: "Each field needs a label, and there must be between 1 and 20 fields.",
    };
  }

  const { error } = await access.supabase.from("form_templates").upsert({
    slug: MATERIAL_FIELDS_SLUG,
    title: "Company Materials fields",
    content: JSON.stringify(clean),
    updated_at: nowIso(),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/forms/materials");
  revalidatePath("/portal/setup", "layout");
  return { ok: true };
}
