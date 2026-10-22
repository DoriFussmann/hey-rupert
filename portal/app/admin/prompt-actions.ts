"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isClaudeConfigured } from "@/lib/anthropic";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  buildNarrative,
  draftEmailCopy,
  draftFeedbackEmail,
  draftIntakeBrief,
  draftInvestorListEmail,
  draftNarrativeEmail,
  runMaterialsAnalysis,
} from "@/lib/agents-server";
import { loadInterviewGuide } from "@/lib/company-profile/server";
import { loadIntakeSettings, loadInterview, nextInterviewTurn, writeInterviewSummary } from "@/lib/intake-server";
import { extractAnswers } from "@/lib/match/profile-server";
import { draftNudge, loadNudgeDetail } from "@/lib/nudge-server";
import { PROMPT_NOTE_MAX, isPromptKey, promptDefinition, promptTextProblems, type PromptKey, type PromptOverride } from "@/lib/prompts";
import { listPromptVersions, savePromptVersion } from "@/lib/prompts-server";
import { asFeedback, asInvestorListDraft, asNarrative } from "@/lib/setup";
import { loadSetupStep } from "@/lib/setup-server";
import { loadTaxonomy } from "@/lib/taxonomy/server";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;

async function requireAdmin() {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  return { ok: true as const, supabase: createServiceClient(), actor: user.email ?? null };
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function revalidatePrompt(key: PromptKey) {
  revalidatePath("/admin/forms/agents");
  revalidatePath(`/admin/forms/agents/${key}`);
}

/** Saves the text as the prompt's next version and makes it active. It applies to the next run; nothing is re-run or sent. */
export async function savePromptAction(key: string, text: string, note: string): Promise<Result<{ version: number }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (!isPromptKey(key)) return { ok: false, error: "Unknown prompt." };
  const body = typeof text === "string" ? text : "";
  const problems = promptTextProblems(body);
  if (problems.length > 0) return { ok: false, error: problems.join(" ") };
  try {
    const saved = await savePromptVersion(access.supabase, key, body, typeof note === "string" ? note.slice(0, PROMPT_NOTE_MAX) : "", access.actor);
    if (!saved.ok) return saved;
    revalidatePrompt(key);
    return { ok: true, version: saved.value.version };
  } catch (err) {
    return { ok: false, error: errorText(err, "The prompt was not saved.") };
  }
}

/** Makes an earlier version active again, by saving its text as the next version. History is never rewritten. */
export async function restorePromptVersionAction(key: string, version: number): Promise<Result<{ version: number }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (!isPromptKey(key)) return { ok: false, error: "Unknown prompt." };
  const versions = await listPromptVersions(access.supabase, key);
  if (!versions.ok) return versions;
  const source = versions.value.find((item) => item.version === Number(version));
  if (!source) return { ok: false, error: "That version doesn't exist." };
  if (versions.value[0]?.version === source.version) return { ok: false, error: `Version ${source.version} is already active.` };
  try {
    const saved = await savePromptVersion(access.supabase, key, source.content, `Restored from version ${source.version}.`, access.actor);
    if (!saved.ok) return saved;
    revalidatePrompt(key);
    return { ok: true, version: saved.value.version };
  } catch (err) {
    return { ok: false, error: errorText(err, "The version was not restored.") };
  }
}

export type PromptTestOutput = { title: string; sections: { label: string; text: string }[] };

async function loadClient(supabase: ReturnType<typeof createServiceClient>, clientId: string) {
  const { data, error } = await supabase.from("clients").select("*").eq("id", clientId).maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "Client not found." };
  return { ok: true as const, client: data as Record<string, unknown> };
}

function email(subject: string, body: string): PromptTestOutput["sections"] {
  return [
    { label: "Subject", text: subject },
    { label: "Body (the greeting, portal link and signature are added when it is drafted for real)", text: body },
  ];
}

/** Runs one prompt for one client without saving, so the admin can judge an edit. */
async function runTest(
  supabase: ReturnType<typeof createServiceClient>,
  key: PromptKey,
  clientId: string,
  override: PromptOverride | null,
): Promise<Result<{ output: PromptTestOutput }>> {
  const loaded = await loadClient(supabase, clientId);
  if (!loaded.ok) return loaded;
  const client = loaded.client;
  const title = promptDefinition(key).title;

  if (key === "intake_interviewer" || key === "intake_summary" || key === "match_profile") {
    const interview = await loadInterview(supabase, clientId);
    if (!interview.ok) return { ok: false, error: interview.error };
    if (!interview.interview || interview.interview.messages.length === 0) {
      return { ok: false, error: "This client has no intake interview yet." };
    }
    const current = interview.interview;
    if (key === "match_profile") {
      const taxonomy = await loadTaxonomy(supabase);
      const extracted = await extractAnswers(supabase, client, current, taxonomy.ok ? taxonomy.value : null, override);
      if (!extracted.ok) return extracted;
      return {
        ok: true,
        output: {
          title,
          sections: [
            { label: "Profile fields", text: JSON.stringify(extracted.answers, null, 2) },
            ...(extracted.classification ? [{ label: "Classification", text: JSON.stringify(extracted.classification, null, 2) }] : []),
          ],
        },
      };
    }
    const settings = await loadIntakeSettings(supabase);
    if (key === "intake_summary") {
      const summary = await writeInterviewSummary(supabase, settings, client, current.messages, current.topic_status, override);
      if (!summary.ok) return { ok: false, error: summary.reason };
      return { ok: true, output: { title, sections: summary.items.map((item) => ({ label: item.title, text: item.answer })) } };
    }
    const guide = current.classification_guide ? await loadInterviewGuide(supabase) : null;
    // Replays Rupert's reply to the founder's latest message (or the opening, before any).
    const lastFounder = current.messages.map((message) => message.role).lastIndexOf("user");
    const upTo = lastFounder >= 0 ? current.messages.slice(0, lastFounder + 1) : [];
    const turn = await nextInterviewTurn(supabase, settings, client, upTo, current.topic_status, undefined, guide, override);
    if (!turn.ok) return { ok: false, error: turn.reason };
    return {
      ok: true,
      output: {
        title,
        sections: [
          { label: lastFounder >= 0 ? "Rupert's reply to the founder's latest message" : "Rupert's opening message", text: turn.turn.reply },
          { label: "Topic coverage it reports", text: turn.turn.topics.map((topic) => `${topic.id}: ${topic.status}${topic.note ? ` (${topic.note})` : ""}`).join("\n") },
        ],
      },
    };
  }

  if (key === "intake_brief") {
    const brief = await draftIntakeBrief(supabase, clientId, override);
    if (!brief.ok) return brief;
    const value = brief.value;
    return {
      ok: true,
      output: {
        title,
        sections: [
          { label: "Brief", text: value.summary },
          { label: "Fields", text: `Industry: ${value.industry}\nGeography: ${value.geography}\nStage: ${value.stage}\nRaise: ${value.raise_amount}` },
        ],
      },
    };
  }
  if (key === "materials_analysis") {
    const analysis = await runMaterialsAnalysis(supabase, clientId, override);
    if (!analysis.ok) return analysis;
    return {
      ok: true,
      output: {
        title,
        sections: [
          { label: "Company Summary", text: analysis.value.analysis.summary },
          { label: "Investor Framing", text: analysis.value.analysis.framing },
        ],
      },
    };
  }
  if (key === "outreach_narrative") {
    const built = await buildNarrative(supabase, clientId, override);
    if (!built.ok) return built;
    const narrative = built.value.narrative;
    return {
      ok: true,
      output: {
        title,
        sections: [
          { label: "Core story", text: narrative.core },
          { label: "Key messages", text: narrative.key_messages },
          { label: "Approach", text: narrative.approach },
          ...(narrative.change_summary ? [{ label: "Changes (Rupert only)", text: narrative.change_summary }] : []),
        ],
      },
    };
  }
  if (key === "email_copy") {
    const copy = await draftEmailCopy(supabase, clientId, override);
    if (!copy.ok) return copy;
    const sections = Object.entries(copy.value.tiers).flatMap(([tier, emails]) =>
      (emails ?? []).map((item, index) => ({ label: `Tier ${tier}, email ${index + 1}`, text: `${item.subject ? `Subject: ${item.subject}\n\n` : ""}${item.body}` })),
    );
    return {
      ok: true,
      output: {
        title,
        sections: [
          ...sections,
          { label: "LinkedIn note", text: copy.value.linkedin_note ?? "" },
          { label: "LinkedIn follow-up", text: copy.value.linkedin_followup ?? "" },
        ],
      },
    };
  }
  if (key === "feedback_email" || key === "narrative_email" || key === "investor_list_email") {
    const step = key === "feedback_email" ? "deck_review" : key === "narrative_email" ? "framing" : "investor_list";
    const row = await loadSetupStep(supabase, clientId, step);
    if (!row.ok) return row;
    const version = (row.row?.version ?? 0) + 1;
    const drafted =
      key === "feedback_email"
        ? await draftFeedbackEmail(supabase, clientId, asFeedback(row.row?.draft), version, override)
        : key === "narrative_email"
          ? await draftNarrativeEmail(supabase, clientId, asNarrative(row.row?.draft), version, override)
          : await draftInvestorListEmail(supabase, clientId, asInvestorListDraft(row.row?.draft), version, override);
    if (!drafted.ok) return drafted;
    return { ok: true, output: { title, sections: email(drafted.value.subject, drafted.value.body) } };
  }
  if (key === "nudge_email") {
    const detail = await loadNudgeDetail(supabase, clientId);
    if (!detail.ok) return detail;
    const turn = detail.detail.clientTurns[0];
    if (!turn) return { ok: false, error: "Nothing is waiting on this client, so there is no nudge to draft." };
    const drafted = await draftNudge(supabase, clientId, turn.key, override);
    if (!drafted.ok) return drafted;
    return { ok: true, output: { title: `${title}: ${turn.label}`, sections: email(drafted.email.subject, drafted.email.body) } };
  }
  return { ok: false, error: "This prompt can't be tested from here. Its recent uses are listed below." };
}

/**
 * Runs a prompt for one client and shows the result. Nothing is saved, sent
 * or changed for the client; the use is recorded as a test. `text` is the
 * unsaved text in the editor, or null to test the active version.
 */
export async function testPromptAction(key: string, clientId: string, text: string | null): Promise<Result<{ output: PromptTestOutput }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (!isPromptKey(key)) return { ok: false, error: "Unknown prompt." };
  if (!promptDefinition(key).testable) return { ok: false, error: "This prompt can't be tested from here." };
  if (!isClaudeConfigured()) return { ok: false, error: "Claude is not configured (ANTHROPIC_API_KEY)." };
  const client = String(clientId ?? "");
  if (!UUID.test(client)) return { ok: false, error: "Pick a client." };
  let override: PromptOverride | null = null;
  if (typeof text === "string") {
    const problems = promptTextProblems(text);
    if (problems.length > 0) return { ok: false, error: problems.join(" ") };
    override = { key, text };
  }
  try {
    return await runTest(access.supabase, key, client, override);
  } catch (err) {
    return { ok: false, error: errorText(err, "The test failed.") };
  }
}
