import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { callClaudeTool } from "@/lib/anthropic";
import { promptSystem } from "@/lib/prompts";
import { loadPrompt } from "@/lib/prompts-server";
import type { TaxIndex } from "@/lib/taxonomy/core";
import { groupOf } from "@/lib/match/dry/core";
import { choosableSubSectors, type SubSectorSuggestion } from "@/lib/intake-sub-sector";

type ServiceClient = ReturnType<typeof createServiceClient>;

const SUGGEST_TOOL = {
  name: "suggest",
  description: "Give the closest sub-sectors from the list, closest first.",
  input_schema: {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "A sub-sector id from the list, exactly." },
            why: { type: "string", description: "One plain sentence for the founder on why it fits." },
          },
          required: ["id", "why"],
        },
      },
    },
    required: ["suggestions"],
  },
};

/** The closest sub-sectors to the founder's own description, from the whole list. Ids the list doesn't have are dropped. */
export async function suggestSubSectors(
  supabase: ServiceClient,
  index: TaxIndex,
  input: { clientId: string; description: string; asked: string[]; context: string },
): Promise<{ ok: true; value: SubSectorSuggestion[] } | { ok: false; error: string }> {
  const prompt = await loadPrompt(supabase, "intake_sub_sector", { clientId: input.clientId, purpose: "Intake: closest sub-sectors" });
  if (!prompt.ok) return { ok: false, error: prompt.error };
  const subs = choosableSubSectors(index);
  const byId = new Map(subs.map((n) => [n.id, n]));
  const list = subs
    .map((n) => {
      const group = groupOf(index, n.id);
      return `- ${n.id}: ${n.label} (${group ? index.nodes.get(group)?.label ?? "" : ""}${n.attrs.granularity === "broad" ? ", broad" : ""})`;
    })
    .join("\n");
  const result = await callClaudeTool<{ suggestions?: unknown }>({
    system: promptSystem(prompt.value, "## What Rupert knows about the company", input.context || "Nothing yet.", "## Sub-sectors (id: label (sector))", list),
    messages: [
      {
        role: "user",
        content: `The founder first answered: ${input.asked.join(", ") || "(nothing)"}. None of the sub-sectors under it fitted. In their own words:\n\n${input.description}\n\nCall the suggest tool.`,
      },
    ],
    tool: SUGGEST_TOOL,
    maxTokens: 800,
  });
  if (!result.ok) return { ok: false, error: result.reason };
  const raw = Array.isArray(result.input.suggestions) ? result.input.suggestions : [];
  const out: SubSectorSuggestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = String((item as Record<string, unknown>).id ?? "").trim();
    const node = byId.get(id);
    if (!node || out.some((o) => o.id === id)) continue;
    out.push({ id, label: node.label, why: String((item as Record<string, unknown>).why ?? "").trim().slice(0, 300) });
  }
  return { ok: true, value: out.slice(0, 3) };
}
