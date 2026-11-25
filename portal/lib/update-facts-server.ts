import "server-only";
import { callClaudeAgent, type ClaudeContentBlock } from "@/lib/anthropic";
import { loadClientFeedback } from "@/lib/client-feedback-server";
import { prepareFiles } from "@/lib/material-files-server";
import { promptSystem } from "@/lib/prompts";
import { loadPrompt } from "@/lib/prompts-server";
import { asMaterials, asNarrative, type SetupStepState } from "@/lib/setup";
import { factsAnchor as anchorFrom } from "@/lib/reanalyze";
import { loadSetupSteps } from "@/lib/setup-server";
import type { createServiceClient } from "@/lib/supabase/admin";
import {
  FACT_TARGET_LABEL,
  UPDATE_FACTS_TOOL,
  applyFactEdits,
  asFactEdits,
  leavesText,
  textLeaves,
  type FactChange,
  type FactEdit,
  type FactTargetId,
  type SkippedEdit,
  type TextLeaf,
} from "@/lib/update-facts";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const CLIENT_FIELDS = ["company_description", "raise_amount", "raise_stage", "geography", "vertical"] as const;
// Narrative keys that are bookkeeping, attachments or the email, not facts.
const NARRATIVE_SKIP = [
  "client_email",
  "internal_update",
  "attachments",
  "links",
  "read",
  "skipped",
  "generated_at",
  "finalized_at",
  "questions_confirmed_at",
  "change_summary",
];

export type FactUpdateRecord = {
  id: string;
  createdAt: string;
  createdBy: string | null;
  note: string;
  sources: { files: string[]; notes: string[]; adminNote: boolean };
  changes: FactChange[];
  skipped: SkippedEdit[];
  untouched: string[];
};

export const FACT_UPDATES_MIGRATION =
  "The Update Facts log table is missing. Run portal/supabase/fact_updates.sql in the Supabase SQL editor.";

function tableError(message: string, code?: string) {
  return code === "42P01" || code === "PGRST205" || /fact_updates/.test(message) ? FACT_UPDATES_MIGRATION : message;
}

function str(value: unknown) {
  return typeof value === "string" ? value : "";
}

function time(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? null : parsed;
}

function isAfter(value: string | null | undefined, anchor: number | null) {
  const at = time(value);
  return at != null && (anchor == null || at > anchor);
}

/** When Rupert's texts were last brought up to date: the same rule as the page (lib/reanalyze). */
export async function factsAnchor(supabase: ServiceClient, clientId: string): Promise<string | null> {
  const [last, profile, grouped] = await Promise.all([
    supabase.from("fact_updates").select("created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("match_profiles").select("built_at").eq("client_id", clientId).maybeSingle(),
    loadSetupSteps(supabase, [clientId]),
  ]);
  const framing = (grouped.get(clientId) ?? []).find((row) => row.step === "framing");
  const narrative = asNarrative(framing?.draft ?? framing?.published);
  return anchorFrom({
    feedbackAt: narrative.feedback?.generated_at ?? null,
    factsUpdatedAt: str(last.data?.created_at) || null,
    profileBuiltAt: str(profile.data?.built_at) || null,
  });
}

/** What is new since the texts were last brought up to date. */
export async function newFactSources(supabase: ServiceClient, clientId: string) {
  const anchor = await factsAnchor(supabase, clientId);
  const at = time(anchor);
  const [grouped, feedback] = await Promise.all([loadSetupSteps(supabase, [clientId]), loadClientFeedback(supabase, clientId)]);
  const materialsRow = (grouped.get(clientId) ?? []).find((row) => row.step === "materials");
  const materials = asMaterials(materialsRow?.published ?? materialsRow?.draft);
  const files = materials.files.filter((file) => isAfter(file.uploaded_at, at));
  const notes = feedback.ok ? feedback.value.filter((item) => isAfter(item.createdAt, at)) : [];
  return { anchor, files, notes, rows: grouped.get(clientId) ?? [] };
}

type Target = {
  id: FactTargetId;
  value: unknown;
  leaves: TextLeaf[];
  save: (next: unknown) => Promise<Result<null>>;
};

async function gatherTargets(
  supabase: ServiceClient,
  clientId: string,
  rows: SetupStepState[],
  actor: string | null,
): Promise<{ targets: Target[]; untouched: string[] }> {
  const targets: Target[] = [];
  const untouched: string[] = [];
  const now = () => new Date().toISOString();

  const [client, interview, brief, profile] = await Promise.all([
    supabase.from("clients").select("company_description, raise_amount, raise_stage, geography, vertical").eq("id", clientId).maybeSingle(),
    supabase.from("intake_interviews").select("admin_brief").eq("client_id", clientId).maybeSingle(),
    supabase.from("company_briefs").select("version, sections, points, deck").eq("client_id", clientId).order("version", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("match_profiles").select("answers").eq("client_id", clientId).maybeSingle(),
  ]);

  if (client.data) {
    const value = Object.fromEntries(CLIENT_FIELDS.map((key) => [key, str((client.data as unknown as Record<string, unknown>)[key])]));
    targets.push({
      id: "client",
      value,
      // Short values like "$10M" still count here.
      leaves: CLIENT_FIELDS.map((key) => ({ path: key, text: value[key] })).filter((leaf) => leaf.text.trim()),
      save: async (next) => {
        const { error } = await supabase.from("clients").update(next as Record<string, string>).eq("id", clientId);
        return error ? { ok: false, error: error.message } : { ok: true, value: null };
      },
    });
  }

  const adminBrief = interview.data?.admin_brief;
  if (adminBrief && typeof adminBrief === "object") {
    const leaves = textLeaves(adminBrief);
    const raise = str((adminBrief as Record<string, unknown>).raise_amount);
    if (raise && !leaves.some((leaf) => leaf.path === "raise_amount")) leaves.push({ path: "raise_amount", text: raise });
    targets.push({
      id: "intake",
      value: adminBrief,
      leaves,
      save: async (next) => {
        const { error } = await supabase.from("intake_interviews").update({ admin_brief: next }).eq("client_id", clientId);
        return error ? { ok: false, error: error.message } : { ok: true, value: null };
      },
    });
  }

  if (brief.data) {
    const value = { sections: brief.data.sections, points: brief.data.points, deck: brief.data.deck };
    const version = Number(brief.data.version);
    targets.push({
      id: "brief",
      value,
      leaves: textLeaves(value),
      save: async (next) => {
        const content = next as { sections: unknown; points: unknown; deck: unknown };
        const { error } = await supabase.from("company_briefs").insert({
          client_id: clientId,
          version: version + 1,
          sections: content.sections,
          points: content.points,
          deck: content.deck,
          note: "Update Facts: brought in line with the newer materials and client notes.",
          created_by: actor,
        });
        return error ? { ok: false, error: error.message } : { ok: true, value: null };
      },
    });
  }

  if (profile.data?.answers && typeof profile.data.answers === "object") {
    const answers = profile.data.answers as Record<string, unknown>;
    const leaves = textLeaves(answers);
    // Short answers like "$10M" or "Seed" are facts too.
    for (const [key, value] of Object.entries(answers)) {
      if (typeof value === "string" && value.trim() && !leaves.some((leaf) => leaf.path === key)) leaves.push({ path: key, text: value });
    }
    targets.push({
      id: "profile",
      value: answers,
      leaves,
      save: async (next) => {
        const at = now();
        const { error } = await supabase.from("match_profiles").update({ answers: next, edited_at: at, updated_at: at }).eq("client_id", clientId);
        return error ? { ok: false, error: error.message } : { ok: true, value: null };
      },
    });
  }

  const framing = rows.find((row) => row.step === "framing");
  if (framing) {
    const draft = framing.draft && typeof framing.draft === "object" ? (framing.draft as Record<string, unknown>) : {};
    const internal = draft.internal_update && typeof draft.internal_update === "object" ? (draft.internal_update as Record<string, unknown>) : null;
    const confirmed = framing.status === "confirmed";
    // A confirmed narrative is updated internally: the client keeps the version they confirmed.
    const base = confirmed ? (internal?.narrative ?? framing.published) : draft;
    if (base && typeof base === "object") {
      targets.push({
        id: "narrative",
        value: base,
        leaves: textLeaves(base, NARRATIVE_SKIP),
        save: async (next) => {
          const at = now();
          const nextDraft = confirmed ? { ...draft, internal_update: { at, narrative: next } } : next;
          const { data, error } = await supabase
            .from("setup_steps")
            .update({ draft: nextDraft, updated_at: at })
            .eq("client_id", clientId)
            .eq("step", "framing")
            .eq("version", framing.version)
            .eq("status", framing.status)
            .select("client_id");
          if (error) return { ok: false, error: error.message };
          return data && data.length > 0 ? { ok: true, value: null } : { ok: false, error: "The narrative changed meanwhile." };
        },
      });
    }
  }

  const copy = rows.find((row) => row.step === "email_copy");
  if (copy && copy.draft && typeof copy.draft === "object") {
    if (copy.status === "confirmed") {
      untouched.push("Email copy: the client confirmed it, so it was not changed. Check it by hand.");
    } else {
      const draft = copy.draft as Record<string, unknown>;
      targets.push({
        id: "email_copy",
        value: draft,
        leaves: textLeaves(draft, ["client_email"]),
        save: async (next) => {
          const { data, error } = await supabase
            .from("setup_steps")
            .update({ draft: next, updated_at: now() })
            .eq("client_id", clientId)
            .eq("step", "email_copy")
            .eq("version", copy.version)
            .select("client_id");
          if (error) return { ok: false, error: error.message };
          return data && data.length > 0 ? { ok: true, value: null } : { ok: false, error: "The email copy changed meanwhile." };
        },
      });
    }
  }

  return { targets: targets.filter((target) => target.leaves.length > 0), untouched };
}

function formatDay(iso: string) {
  const at = time(iso);
  return at == null ? iso : new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Update Facts: one AI pass over everything Rupert wrote about the company,
 * against the files and client notes that are new since the last analysis
 * (and Rupert's own note). Saves the edits, logs them, and returns the log.
 */
export async function runUpdateFacts(
  supabase: ServiceClient,
  clientId: string,
  { note, actor }: { note: string; actor: string | null },
): Promise<Result<FactUpdateRecord>> {
  const adminNote = note.trim().slice(0, 8000);
  const fresh = await newFactSources(supabase, clientId);
  if (fresh.files.length === 0 && fresh.notes.length === 0 && !adminNote) {
    return { ok: false, error: "Nothing new since the last analysis: add files, log the client's note, or write a note here." };
  }

  const { targets, untouched } = await gatherTargets(supabase, clientId, fresh.rows, actor);
  if (targets.length === 0) return { ok: false, error: "There is nothing written about this company yet. Run the analysis first." };

  const prompt = await loadPrompt(supabase, "update_facts", { clientId, purpose: "Update Facts", actor: actor ?? undefined });
  if (!prompt.ok) return prompt;

  const prepared = fresh.files.length > 0 ? await prepareFiles(supabase, fresh.files) : { blocks: [], read: [], skipped: [] };
  const noteLines = fresh.notes.map(
    (item) => `- Client note, ${formatDay(item.on || item.createdAt)} (${item.channel}):\n${(item.original || item.summary || "").trim()}`,
  );
  const sources = [
    "## Newer sources (these override Rupert's texts)",
    prepared.read.length > 0 ? `New files, attached below: ${prepared.read.join(", ")}.` : "No new files.",
    prepared.skipped.length > 0 ? `New files the AI can't read: ${prepared.skipped.join(" ")}` : "",
    noteLines.length > 0 ? `What the client said outside the portal:\n${noteLines.join("\n\n")}` : "",
    adminNote ? `Rupert's note, ${formatDay(new Date().toISOString())}:\n${adminNote}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const texts = ["## Rupert's texts (edit only these, by path)", ...targets.map((target) => leavesText(target.id, target.leaves))].join("\n\n");

  const content: ClaudeContentBlock[] = [
    ...prepared.blocks,
    { type: "text", text: `${sources}\n\n${texts}\n\nReport the edits by calling ${UPDATE_FACTS_TOOL.name}.` },
  ];
  const result = await callClaudeAgent<Record<string, unknown>>({
    system: promptSystem(prompt.value),
    content,
    tool: UPDATE_FACTS_TOOL as unknown as Parameters<typeof callClaudeAgent>[0]["tool"],
    maxTokens: 16000,
  });
  if (!result.ok) return { ok: false, error: result.reason };

  const edits = asFactEdits(result.input, new Set(targets.map((target) => target.id)));
  const changes: FactChange[] = [];
  const skipped: SkippedEdit[] = [];
  for (const target of targets) {
    const mine = edits.filter((edit) => edit.target === target.id);
    if (mine.length === 0) continue;
    const applied = applyFactEdits(target.value, mine, new Set(target.leaves.map((leaf) => leaf.path)));
    skipped.push(...applied.skipped);
    if (applied.applied.length === 0) continue;
    const saved = await target.save(applied.value);
    if (!saved.ok) {
      skipped.push(...applied.applied.map((edit: FactEdit) => ({ ...edit, why: `Not saved: ${saved.error}` })));
      continue;
    }
    changes.push(...applied.applied.map((edit) => ({ ...edit, label: FACT_TARGET_LABEL[target.id] })));
  }

  const record = {
    client_id: clientId,
    created_by: actor,
    note: adminNote,
    sources: {
      files: fresh.files.map((file) => file.name),
      notes: fresh.notes.map((item) => `${formatDay(item.on || item.createdAt)} · ${item.channel}`),
      adminNote: Boolean(adminNote),
    },
    changes,
    skipped,
    untouched,
  };
  const { data, error } = await supabase.from("fact_updates").insert(record).select("id, created_at").single();
  if (error) return { ok: false, error: tableError(error.message, error.code) };

  return {
    ok: true,
    value: {
      id: str(data.id),
      createdAt: str(data.created_at),
      createdBy: actor,
      note: adminNote,
      sources: record.sources,
      changes,
      skipped,
      untouched,
    },
  };
}

/** The most recent Update Facts runs for a client, newest first. */
export async function listFactUpdates(supabase: ServiceClient, clientId: string, limit = 5): Promise<Result<FactUpdateRecord[]>> {
  const { data, error } = await supabase
    .from("fact_updates")
    .select("id, created_at, created_by, note, sources, changes, skipped, untouched")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    const message = tableError(error.message, error.code);
    return message === FACT_UPDATES_MIGRATION ? { ok: true, value: [] } : { ok: false, error: message };
  }
  return {
    ok: true,
    value: (data ?? []).map((row) => ({
      id: str(row.id),
      createdAt: str(row.created_at),
      createdBy: row.created_by ? str(row.created_by) : null,
      note: str(row.note),
      sources: (row.sources ?? { files: [], notes: [], adminNote: false }) as FactUpdateRecord["sources"],
      changes: (Array.isArray(row.changes) ? row.changes : []) as FactChange[],
      skipped: (Array.isArray(row.skipped) ? row.skipped : []) as SkippedEdit[],
      untouched: (Array.isArray(row.untouched) ? row.untouched : []) as string[],
    })),
  };
}
