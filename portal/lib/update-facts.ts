// Update Facts: corrects the facts in what Rupert has already written about a
// company (intake brief, company brief, match profile, narrative, email copy)
// from newer materials and client notes, without changing its structure,
// order or decisions. Pure module: the text the AI may touch, the edits it
// returns, and how they are applied, so the rules are tested.

export type FactTargetId = "client" | "intake" | "brief" | "profile" | "narrative" | "email_copy";

export const FACT_TARGET_LABEL: Record<FactTargetId, string> = {
  client: "Client record",
  intake: "Intake brief",
  brief: "Company brief",
  profile: "Match profile",
  narrative: "Narrative",
  email_copy: "Email copy",
};

/** One editable piece of text: where it lives and what it says. */
export type TextLeaf = { path: string; text: string };

/** One edit the AI proposes: replace `find` with `replace` inside one text. */
export type FactEdit = {
  target: FactTargetId;
  path: string;
  find: string;
  replace: string;
  reason: string;
  source: string;
};

/** One edit as applied, for the summary. */
export type FactChange = FactEdit & { label: string };

export type SkippedEdit = FactEdit & { why: string };

// Keys whose values are identifiers, dates or settings, never facts to edit.
const SKIP_KEY = /(^|_)(id|ids|at|status|key|keys|slug|path|url|urls|type|tier|tiers_key|run_id|version|kind|role|score|scores_key|by|email)$/i;
const MIN_TEXT = 12;
const URL_ONLY = /^\s*https?:\/\/\S+\s*$/;

/** Every string worth checking in a JSON value, addressed by a "/"-separated path. */
export function textLeaves(value: unknown, skipKeys: string[] = []): TextLeaf[] {
  const out: TextLeaf[] = [];
  const skip = new Set(skipKeys);
  const walk = (node: unknown, path: string, key: string) => {
    if (typeof node === "string") {
      if (node.trim().length >= MIN_TEXT && !URL_ONLY.test(node)) out.push({ path, text: node });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}/${index}`, key));
      return;
    }
    if (node && typeof node === "object") {
      for (const [childKey, child] of Object.entries(node as Record<string, unknown>)) {
        if (skip.has(childKey) || SKIP_KEY.test(childKey)) continue;
        walk(child, path ? `${path}/${childKey}` : childKey, childKey);
      }
    }
  };
  walk(value, "", "");
  return out;
}

function segments(path: string) {
  return path.split("/").filter((part) => part !== "");
}

function getAt(value: unknown, path: string): unknown {
  let node = value;
  for (const part of segments(path)) {
    if (Array.isArray(node)) node = node[Number(part)];
    else if (node && typeof node === "object") node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  return node;
}

/** A copy of `value` with the string at `path` replaced. */
function setAt<T>(value: T, path: string, next: string): T {
  const parts = segments(path);
  const clone = (node: unknown, index: number): unknown => {
    if (index === parts.length) return next;
    const part = parts[index];
    if (Array.isArray(node)) {
      const copy = node.slice();
      copy[Number(part)] = clone(node[Number(part)], index + 1);
      return copy;
    }
    const record = (node && typeof node === "object" ? node : {}) as Record<string, unknown>;
    return { ...record, [part]: clone(record[part], index + 1) };
  };
  return clone(value, 0) as T;
}

/**
 * Applies the edits for one target. Each edit must name a text that exists
 * and quote `find` exactly as it appears there; anything else is skipped and
 * reported, never guessed. The structure of the value never changes.
 */
export function applyFactEdits<T>(
  value: T,
  edits: FactEdit[],
  allowed: Set<string>,
): { value: T; applied: FactEdit[]; skipped: SkippedEdit[] } {
  let current = value;
  const applied: FactEdit[] = [];
  const skipped: SkippedEdit[] = [];
  for (const edit of edits) {
    if (!allowed.has(edit.path)) {
      skipped.push({ ...edit, why: "Not a text Update Facts may change." });
      continue;
    }
    const text = getAt(current, edit.path);
    if (typeof text !== "string") {
      skipped.push({ ...edit, why: "That text no longer exists." });
      continue;
    }
    if (!edit.find || edit.find === edit.replace) {
      skipped.push({ ...edit, why: "Nothing to change." });
      continue;
    }
    if (!text.includes(edit.find)) {
      skipped.push({ ...edit, why: "The words to replace were not found exactly." });
      continue;
    }
    current = setAt(current, edit.path, text.split(edit.find).join(edit.replace));
    applied.push(edit);
  }
  return { value: current, applied, skipped };
}

/** The AI's answer, cleaned: unknown targets and empty edits are dropped. */
export function asFactEdits(raw: unknown, targets: Set<FactTargetId>): FactEdit[] {
  const list = raw && typeof raw === "object" ? (raw as { edits?: unknown }).edits : null;
  if (!Array.isArray(list)) return [];
  const str = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
  const edits: FactEdit[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const target = str(entry.target, 20) as FactTargetId;
    if (!targets.has(target)) continue;
    const edit: FactEdit = {
      target,
      path: str(entry.path, 300),
      find: str(entry.find, 4000),
      replace: str(entry.replace, 4000),
      reason: str(entry.reason, 400).trim(),
      source: str(entry.source, 200).trim(),
    };
    if (!edit.path || !edit.find) continue;
    edits.push(edit);
  }
  return edits;
}

/** The texts, as the AI reads them: one block per target, one line per text. */
export function leavesText(target: FactTargetId, leaves: TextLeaf[]) {
  return [
    `### ${target} — ${FACT_TARGET_LABEL[target]}`,
    ...leaves.map((leaf) => `[${target}:${leaf.path}]\n${leaf.text}`),
  ].join("\n\n");
}

/** A short "before → after" for the summary window. */
export function changeLine(change: FactEdit) {
  const clip = (value: string) => (value.length > 220 ? `${value.slice(0, 217)}…` : value);
  return { before: clip(change.find.trim()), after: clip(change.replace.trim()) };
}

export const UPDATE_FACTS_TOOL = {
  name: "report_fact_edits",
  description: "Report the exact text edits that bring Rupert's texts in line with the newer materials and notes.",
  input_schema: {
    type: "object",
    properties: {
      edits: {
        type: "array",
        description: "One entry per edit. An empty list when nothing needs to change.",
        items: {
          type: "object",
          properties: {
            target: { type: "string", enum: ["client", "intake", "brief", "profile", "narrative", "email_copy"] },
            path: { type: "string", description: "The text's path, exactly as given in brackets after the target (without the target and colon)." },
            find: { type: "string", description: "The words to replace, copied exactly from that text. As short as possible while unique: a phrase or a sentence, never the whole text." },
            replace: { type: "string", description: "What replaces them. Same style and length where possible." },
            reason: { type: "string", description: "One short sentence for Rupert: what changed and why, e.g. 'Ask raised from $9.8M to $10M.'" },
            source: { type: "string", description: "Where the new fact comes from, e.g. 'New deck, slide 13' or 'Client note, Nov 24'." },
          },
          required: ["target", "path", "find", "replace", "reason", "source"],
        },
      },
    },
    required: ["edits"],
  },
} as const;
