import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { callClaudeAgent, type ClaudeTool } from "@/lib/anthropic";
import { REPLY_LABELS, asReplyLabel, type ReplyLabel } from "@/lib/outreach/live";
import { promptSystem } from "@/lib/prompts";
import { loadPrompt } from "@/lib/prompts-server";

// Claude labels a reply. Kept apart from the webhook and triage code, which
// can email Rupert: code that runs AI calls never imports anything that sends.

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const str = (value: unknown, max = 20000) => (value == null ? "" : String(value)).slice(0, max);

const LABEL_TOOL: ClaudeTool = {
  name: "label_reply",
  description: "Label the reply and summarise it.",
  input_schema: {
    type: "object",
    properties: {
      label: { type: "string", enum: REPLY_LABELS.map((item) => item.value) },
      summary: { type: "string", description: "One short sentence." },
    },
    required: ["label", "summary"],
  },
};

/** Claude's label and one-line summary. Rupert's decision is separate. */
export async function labelReply(supabase: ServiceClient, id: string): Promise<Result<{ label: ReplyLabel; summary: string }>> {
  const { data, error } = await supabase.from("outreach_replies").select("*").eq("id", id).maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "Reply not found." };
  const prompt = await loadPrompt(supabase, "reply_triage", { clientId: String(data.client_id), purpose: "Reply triage" });
  if (!prompt.ok) return prompt;
  const result = await callClaudeAgent<Record<string, unknown>>({
    system: promptSystem(prompt.value),
    content: [
      {
        type: "text",
        text: `From: ${data.person_name || data.lead_email}${data.fund_name ? ` at ${data.fund_name}` : ""}\nSubject: ${data.subject}\n\n${str(data.body, 8000)}\n\nCall ${LABEL_TOOL.name}.`,
      },
    ],
    tool: LABEL_TOOL,
    maxTokens: 400,
  });
  if (!result.ok) return { ok: false, error: result.reason };
  const label = asReplyLabel(result.input.label) ?? "other";
  const summary = str(result.input.summary, 500).trim();
  const saved = await supabase.from("outreach_replies").update({ label, summary, labelled_at: new Date().toISOString() }).eq("id", id);
  if (saved.error) return { ok: false, error: saved.error.message };
  return { ok: true, value: { label, summary } };
}

