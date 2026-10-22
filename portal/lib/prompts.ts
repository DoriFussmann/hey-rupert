// Every AI prompt Rupert uses: what it is for, where it is stored, and its
// starting text. Pure module (no server code), so the registry, the checks
// and the starting texts can be tested and shared with the admin pages.
//
// The prompts themselves live in the database (form_templates, one row per
// prompt, with every saved version in form_template_versions). At runtime
// the app reads the active version and never falls back to the text here:
// a missing or invalid prompt stops the action with a clear error. The
// texts below are only the starting versions (loaded by the migration) and
// what "Reset to default" puts back in the editor.
//
// What a prompt edit can't change: the data each AI call receives, the
// shape of its answer (tool schemas), the checks applied to that answer,
// eligibility rules, and whether anything is saved or sent. Those are code.

import { AGENTS, agentPromptSlug, type AgentId } from "./agents.ts";
import { DEFAULT_INTAKE_PROMPT, INTAKE_PROMPT_SLUG } from "./intake.ts";
import { PROMPT_LIST, type PromptGroup, type PromptKey } from "./prompt-list.ts";

export { PROMPT_GROUPS, promptPath, type PromptGroup, type PromptKey } from "./prompt-list.ts";

export type PromptDefinition = {
  key: PromptKey;
  /** The form_templates row it is stored in. */
  slug: string;
  title: string;
  group: PromptGroup;
  /** Where and when it runs. */
  usedBy: string;
  /** What the code adds around it, which a prompt edit can't change. */
  fixed: string;
  /** Whether the admin can run it on a client from the prompt page without saving anything. */
  testable: boolean;
  defaultText: string;
};

/** Longest prompt text accepted. */
export const PROMPT_MAX = 20000;
export const PROMPT_NOTE_MAX = 300;

/** Added to the intake interviewer's starting text: how to close the essentials and how to open. */
export const INTAKE_INTERVIEWER_ADDITIONS = `## When the essentials are done
The intake is complete as soon as every required topic is covered: Rupert then has what he needs to start, and the founder is notified that the essentials are done. When your topic update marks the last required topic as covered (in this turn or earlier), make this clear in your reply, once: say warmly that the essentials are done and Rupert has what he needs to get started; then name the remaining optional topics, explain in one sentence that a few more minutes on them can make the campaign noticeably sharper, recommend continuing, and ask whether they would like to. If they prefer to stop, thank them and tell them they are all set. If every topic, required and optional, is covered, thank them and say they can review their summary anytime. This section overrides any earlier instruction about when to offer the summary.

## Opening
When the founder has just opened the interview, greet them by first name if you know it, explain in one sentence what this is for and roughly how long it takes, then ask your first question.`;

const INTAKE_SUMMARY_PROMPT = `You write the intake summary for Hey Rupert's team from an interview with a founder.

For each topic, write a concise, factual answer in plain sentences or short lists, using only what the founder said or what was already known. If nothing was learned for a topic, answer exactly "Not provided." Do not add opinions or advice.`;

const NARRATIVE_EMAIL_REVISION_PROMPT = `This email answers the founder's requested changes to the narrative. Write it as a reply to their notes, instead of the usual structure:
1. Thank them briefly and confirm the changes they asked for, naming each one in a few words. Use only the list of changes you receive; never claim a change that is not listed there.
2. Say the updated narrative is in their portal.
3. Say Rupert would like to start investor matching: ask them to confirm the narrative in the portal so he can begin, or to reply with any further comments. If the Analysis & Feedback is not confirmed yet (its status is given below), ask them to confirm both.
Keep it under 140 words.`;

const VERIFY_ROLE_CHECK_PROMPT = `You check whether a person in an investor database still works at the firm listed for them, and in what role. Use web search. The firm's own team page and public LinkedIn profiles are the best sources; recent press, portfolio announcements and conference bios also help.

Rules:
- Rely only on pages you actually found in search results. Never guess or invent a URL.
- Make sure a page is about this person: the same name AND this firm, or a clearly matching career. A person with the same name elsewhere is not evidence.
- Prefer the most recent source. When sources disagree, trust the most recent dated one.
- confirmed: a source shows them at this firm in an investing role (for example general partner, managing partner, partner, managing director, principal, vice president, director, associate, analyst, venture partner, investment manager, scout, or a founder of the fund).
- role_changed: they are at this firm but in a non-investing role (for example operations, finance, legal, marketing, investor relations, platform, talent, office or admin).
- left_firm: a source shows they left this firm or now work elsewhere. Give the new firm, its website and their new title when a source shows them.
- not_found: no reliable source either way.

Report through the report_role tool. The summary is one plain sentence.`;

const TAXONOMY_MAPPING_PROMPT = `You map raw labels from an investor database to a fixed taxonomy of canonical categories. Use only category ids from the list. Never invent ids or categories. Use more than one id only when the label genuinely spans several categories. When no category fits, return an empty list and say why. A wrong mapping is worse than none. Give a short, factual rationale and an honest confidence from 0 to 1.`;

const TAXONOMY_RELATIONSHIPS_PROMPT = `You help maintain a sector relationship graph used to decide which venture investors are relevant to a startup.
Propose only relationships an experienced venture investor would defend. Do not add links just to widen matches.
Each rationale must state the concrete reason (shared customers, technology, business model or investor practice).`;

const TEST_DATA_RULES =
  "This is TEST data for an internal test of Hey Rupert's client portal; no real founder sees it. Use the website and any attached deck first. Where something is still unknown, choose realistic, plausible details consistent with the company, so the test exercises every step. Keep answers concise and factual in tone.";

const TEST_PILOT_INTAKE_PROMPT = `You write a founder's intake answers for Hey Rupert, an investor outreach service.

${TEST_DATA_RULES}`;

const TEST_PILOT_MATERIALS_PROMPT = `You fill in a founder's Company Materials form for Hey Rupert.

${TEST_DATA_RULES}`;

type PromptDetails = Omit<PromptDefinition, "key" | "title" | "group">;

const agentDetails = (id: AgentId, fixed: string, testable: boolean): PromptDetails => {
  const agent = AGENTS.find((item) => item.id === id)!;
  return { slug: agentPromptSlug(id), usedBy: agent.description, fixed, testable, defaultText: agent.defaultPrompt };
};

const EMAIL_FIXED = "Only a subject and body come back; the greeting, portal link and signature are added by the code, and sending is always a separate step by an admin.";

const DETAILS: Record<PromptKey, PromptDetails> = {
  intake_interviewer: {
    slug: INTAKE_PROMPT_SLUG,
    usedBy: "Founder portal → Client Intake: writes each of Rupert's replies in the interview.",
    fixed: "What is already known about the company, the interview topics and their coverage, the sector guide, and the reply format (reply, topic coverage, file facts).",
    testable: true,
    defaultText: `${DEFAULT_INTAKE_PROMPT}\n\n${INTAKE_INTERVIEWER_ADDITIONS}`,
  },
  intake_summary: {
    slug: agentPromptSlug("intake_summary"),
    usedBy: "Founder portal → Client Intake → Review summary: writes one answer per topic for the founder to check.",
    fixed: "What was already known, the topics and their coverage, the transcript; one answer per topic comes back.",
    testable: true,
    defaultText: INTAKE_SUMMARY_PROMPT,
  },
  intake_brief: agentDetails(
    "intake_brief",
    "The client record, the confirmed intake summary and the transcript; the answer format (brief, industry, geography, stage, raise).",
    true,
  ),
  materials_analysis: agentDetails(
    "materials_analysis",
    "The company profile, client record, intake, written answers, readable files and the founder's own links; the answer format (summary and framing).",
    true,
  ),
  outreach_narrative: agentDetails(
    "outreach_narrative",
    "The company profile, client record, intake, answers, Rupert's summary and framing, and the founder's change requests; the answer format (three sections, plus changes when revising).",
    true,
  ),
  email_copy: agentDetails(
    "email_copy",
    "The confirmed narrative, the investor list as tier counts and fund types (never names), the intake summary and the analysis; the answer format (three emails per tier, two LinkedIn messages).",
    true,
  ),
  match_profile: agentDetails(
    "match_profile",
    "The intake interview, and the fixed lists of allowed labels and classification rules, which the code checks the answer against.",
    true,
  ),
  feedback_email: agentDetails("feedback_email", `Rupert's edited summary and framing, shared files and links, and company information. ${EMAIL_FIXED}`, true),
  narrative_email: agentDetails("narrative_email", `Rupert's edited narrative, shared files and links, and company information. ${EMAIL_FIXED}`, true),
  narrative_email_revision: {
    slug: agentPromptSlug("narrative_email_revision"),
    usedBy: "Added to the Narrative email when the founder asked for changes: how the reply confirms them.",
    fixed: `The founder's requests, Rupert's list of changes, and whether the Analysis & Feedback is confirmed. ${EMAIL_FIXED}`,
    testable: false,
    defaultText: NARRATIVE_EMAIL_REVISION_PROMPT,
  },
  investor_list_email: agentDetails(
    "investor_list_email",
    `Facts the code prepares from this founder's list only: the confirmed plan, funds and share per tier, up to five Core funds that may be named with their matched criteria, and the verification results with a fixed definition; Rupert's note and company information. ${EMAIL_FIXED}`,
    true,
  ),
  nudge_email: agentDetails("nudge_email", `The waiting step, how long it has waited and the nudges already sent. ${EMAIL_FIXED}`, true),
  verify_role_check: {
    slug: agentPromptSlug("verify_role_check"),
    usedBy: "Verify emails, step 1: checks with web search whether each contact still works at the firm, and in what role.",
    fixed: "The person and firm checked, the web-search limit, and the answer format: confirmed, role changed, left firm or not found, with evidence the code checks.",
    testable: false,
    defaultText: VERIFY_ROLE_CHECK_PROMPT,
  },
  taxonomy_mapping: {
    slug: agentPromptSlug("taxonomy_mapping"),
    usedBy: "Taxonomy → Suggest with AI: proposes categories for raw Fund Database labels. Proposals wait for review.",
    fixed: "The categories allowed and the labels to map; ids the code doesn't know are dropped.",
    testable: false,
    defaultText: TAXONOMY_MAPPING_PROMPT,
  },
  taxonomy_relationships: {
    slug: agentPromptSlug("taxonomy_relationships"),
    usedBy: "Taxonomy → a sector → Suggest relationships: proposes related sectors. Suggestions are saved as needs review.",
    fixed: "The relationship types and their meaning, the limit per request, and the candidate sectors; anything outside them is dropped.",
    testable: false,
    defaultText: TAXONOMY_RELATIONSHIPS_PROMPT,
  },
  test_pilot_intake: {
    slug: agentPromptSlug("test_pilot_intake"),
    usedBy: "Test Pilot → Complete intake: writes made-up intake answers for the test client only.",
    fixed: "The client record, website, attached deck, intake topics, and the profile's allowed labels.",
    testable: false,
    defaultText: TEST_PILOT_INTAKE_PROMPT,
  },
  test_pilot_materials: {
    slug: agentPromptSlug("test_pilot_materials"),
    usedBy: "Test Pilot → Submit materials: fills the Company Materials form for the test client only.",
    fixed: "The client record, intake and the form's fields.",
    testable: false,
    defaultText: TEST_PILOT_MATERIALS_PROMPT,
  },
};

export const PROMPTS: PromptDefinition[] = PROMPT_LIST.map((item) => ({ key: item.key, title: item.title, group: item.group, ...DETAILS[item.key] }));

export function isPromptKey(value: unknown): value is PromptKey {
  return PROMPTS.some((prompt) => prompt.key === value);
}

export function promptDefinition(key: PromptKey): PromptDefinition {
  return PROMPTS.find((prompt) => prompt.key === key)!;
}

/** A prompt as an AI call uses it. Version 0 is unsaved text being tested from the admin. */
export type ActivePrompt = { key: PromptKey; text: string; version: number };

/** Unsaved text the admin is testing, used instead of the active version of that one prompt. */
export type PromptOverride = { key: PromptKey; text: string };

/** One stored prompt row, as read from the database. */
export type PromptRow = { slug: string; content: string | null; active_version: number | null };

/** Problems with prompt text before it is saved or used. Empty when it is fine. */
export function promptTextProblems(text: string): string[] {
  const problems: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) problems.push("The prompt is empty.");
  if (trimmed.length > PROMPT_MAX) problems.push(`Keep the prompt under ${PROMPT_MAX.toLocaleString("en-US")} characters.`);
  return problems;
}

/** The error an action shows when a prompt it needs can't be used. */
export function promptUnavailable(definition: PromptDefinition, why: string) {
  return `The "${definition.title}" prompt can't be used: ${why} Open Agents → ${definition.title} to fix it.`;
}

/**
 * The active prompts for `keys` from the stored rows. Fails, naming the
 * prompt, when one is missing, has no active version, or is invalid. Never
 * substitutes the starting text.
 */
export function resolvePrompts<K extends PromptKey>(
  rows: PromptRow[],
  keys: K[],
  override?: PromptOverride | null,
): { ok: true; value: Record<K, ActivePrompt> } | { ok: false; error: string } {
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const value = {} as Record<K, ActivePrompt>;
  for (const key of keys) {
    const definition = promptDefinition(key);
    if (override && override.key === key) {
      const problems = promptTextProblems(override.text);
      if (problems.length > 0) return { ok: false, error: promptUnavailable(definition, problems.join(" ")) };
      value[key] = { key, text: override.text.trim(), version: 0 };
      continue;
    }
    const row = bySlug.get(definition.slug);
    if (!row || row.active_version == null || row.active_version < 1) {
      return { ok: false, error: promptUnavailable(definition, "it isn't set up yet.") };
    }
    const text = String(row.content ?? "");
    const problems = promptTextProblems(text);
    if (problems.length > 0) return { ok: false, error: promptUnavailable(definition, problems.join(" ")) };
    value[key] = { key, text: text.trim(), version: Number(row.active_version) };
  }
  return { ok: true, value };
}

/**
 * The system text of an AI call: the managed prompt first, then the fixed
 * parts the code adds (data, allowed values, answer contract). Every AI call
 * builds its system text with this, so each one starts from its managed prompt.
 */
export function promptSystem(prompt: ActivePrompt, ...fixed: (string | null | undefined | false)[]) {
  return [prompt.text, ...fixed.filter((part): part is string => typeof part === "string" && part.trim() !== "")].join("\n\n");
}

/** "v3", or "unsaved draft" for a test of text that isn't saved yet. */
export function versionLabel(version: number) {
  return version > 0 ? `v${version}` : "unsaved draft";
}
